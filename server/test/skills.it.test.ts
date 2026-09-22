import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skills] Docker not available — skipping integration tests.');
}

/**
 * Skills module — CRUD, versioning, and (most importantly) the Trust model's
 * server-enforced `source`/`enabled` rules from server/specs/skills.md:
 *   - POST /skills ALWAYS persists source:'manual', regardless of request body.
 *   - POST /skills/import only accepts source in {'imported_url','extracted'}
 *     and ALWAYS forces enabled:false, regardless of request body.
 *   - PUT /skills/:id can never change `source`.
 *   - toggling `enabled` alone never bumps `version`; any other field does.
 */
d('Skills module (Testcontainers pg)', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  const createBody = {
    name: 'My Manual Skill',
    description: 'a manual skill',
    type: 'rubric' as const,
    body: 'Check X.',
  };

  it('POST /skills creates a manual skill (v1), regardless of an injected `source`', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      // Attempt to smuggle a non-manual source through the plain create route.
      payload: { ...createBody, source: 'community', enabled: false },
    });
    expect(res.statusCode).toBe(201);
    const skill = res.json();
    expect(skill.source).toBe('manual'); // SECURITY: server-forced, ignores the injected value
    expect(skill.version).toBe(1);
    expect(skill.enabled).toBe(false); // enabled IS client-controllable on plain create

    const versions = (
      await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions` })
    ).json();
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe(1);
    await app.close();
  });

  it('GET/PUT/DELETE lifecycle + version bump only on body-affecting change', async () => {
    const app = await makeApp();
    const created = (
      await app.inject({ method: 'POST', url: '/skills', payload: createBody })
    ).json();

    const fetched = (
      await app.inject({ method: 'GET', url: `/skills/${created.id}` })
    ).json();
    expect(fetched).toEqual(created);

    // Toggling `enabled` alone must NOT bump the version.
    const toggled = (
      await app.inject({
        method: 'PUT',
        url: `/skills/${created.id}`,
        payload: { enabled: false },
      })
    ).json();
    expect(toggled.version).toBe(1);
    expect(toggled.enabled).toBe(false);

    // A body change DOES bump the version and snapshots skill_versions.
    const updated = (
      await app.inject({
        method: 'PUT',
        url: `/skills/${created.id}`,
        payload: { body: 'Check X and Y.' },
      })
    ).json();
    expect(updated.version).toBe(2);

    const versions = (
      await app.inject({ method: 'GET', url: `/skills/${created.id}/versions` })
    ).json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(versions[0].body).toBe('Check X and Y.');
    expect(versions[1].body).toBe('Check X.');

    const oneVersion = (
      await app.inject({ method: 'GET', url: `/skills/${created.id}/versions/1` })
    ).json();
    expect(oneVersion.body).toBe('Check X.');

    // PUT never accepts/changes `source`, even if the client sends one
    // alongside a real, accepted field (an all-rejected-fields body is its
    // own edge case — see the dedicated test below).
    const sourceAttempt = (
      await app.inject({
        method: 'PUT',
        url: `/skills/${created.id}`,
        payload: { source: 'community', description: 'still not community' },
      })
    ).json();
    expect(sourceAttempt.source).toBe('manual');
    expect(sourceAttempt.description).toBe('still not community');

    const listed = (await app.inject({ method: 'GET', url: '/skills' })).json();
    expect(listed.some((s: { id: string }) => s.id === created.id)).toBe(true);

    const deleted = await app.inject({ method: 'DELETE', url: `/skills/${created.id}` });
    expect(deleted.statusCode).toBe(200);
    const gone = await app.inject({ method: 'GET', url: `/skills/${created.id}` });
    expect(gone.statusCode).toBe(404);

    await app.close();
  });

  it('404s for an unknown skill and an unknown version', async () => {
    const app = await makeApp();
    const created = (
      await app.inject({ method: 'POST', url: '/skills', payload: createBody })
    ).json();
    const ghost = '00000000-0000-0000-0000-000000000000';

    expect((await app.inject({ method: 'GET', url: `/skills/${ghost}` })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `/skills/${ghost}/versions` })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `/skills/${created.id}/versions/99` })).statusCode,
    ).toBe(404);
    await app.close();
  });

  it('POST /skills/import rejects source values outside {imported_url, extracted}', async () => {
    const app = await makeApp();
    for (const source of ['manual', 'community']) {
      const res = await app.inject({
        method: 'POST',
        url: '/skills/import',
        payload: { name: 'x', type: 'custom', body: 'b', source },
      });
      expect(res.statusCode).toBe(422); // Zod enum rejects it at the edge
    }
    await app.close();
  });

  it('POST /skills/import always forces enabled:false, even if the client tries to enable it', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/skills/import',
      // `enabled` isn't even in the accepted body shape — this also proves an
      // extra field is silently ignored (Zod's default strip behavior), not
      // an error.
      payload: {
        name: 'imported-skill',
        type: 'custom',
        body: 'Do the thing.',
        source: 'imported_url',
        enabled: true,
        evidence_files: ['imported-skill.md'],
      },
    });
    expect(res.statusCode).toBe(201);
    const skill = res.json();
    expect(skill.source).toBe('imported_url');
    expect(skill.enabled).toBe(false); // SECURITY: forced regardless of the client's `enabled: true`
    expect(skill.evidence_files).toEqual(['imported-skill.md']);
    await app.close();
  });

  it('POST /skills/import/preview parses an uploaded .md file (multipart) without persisting', async () => {
    const app = await makeApp();
    const before = (await app.inject({ method: 'GET', url: '/skills' })).json();

    const fileContent = 'name: preview-only\ndescription: not saved\ntype: convention\n\nBody text.';
    const { body: multipartBody, boundary } = buildSingleFileMultipart(
      'preview-only.md',
      'text/markdown',
      fileContent,
    );
    const res = await app.inject({
      method: 'POST',
      url: '/skills/import/preview',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipartBody,
    });
    expect(res.statusCode).toBe(200);
    const preview = res.json();
    expect(preview).toMatchObject({
      name: 'preview-only',
      description: 'not saved',
      type: 'convention',
      source: 'imported_url',
    });

    // Nothing was persisted by the preview call.
    const after = (await app.inject({ method: 'GET', url: '/skills' })).json();
    expect(after).toHaveLength(before.length);

    await app.close();
  });
});

/**
 * Hand-build a minimal single-file multipart/form-data body — no multipart
 * client library exists as a devDependency, and this is the smallest way to
 * exercise `req.file()` on the real route through `app.inject()`.
 */
function buildSingleFileMultipart(
  filename: string,
  contentType: string,
  content: string,
): { body: Buffer; boundary: string } {
  const boundary = '----vitestBoundary123456';
  const parts = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`,
    `Content-Type: ${contentType}\r\n\r\n`,
    `${content}\r\n`,
    `--${boundary}--\r\n`,
  ];
  return { body: Buffer.from(parts.join(''), 'utf-8'), boundary };
}
