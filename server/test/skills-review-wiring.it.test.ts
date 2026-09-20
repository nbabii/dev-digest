import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW_FIXTURE: Review = {
  verdict: 'approve',
  summary: 'Looks fine.',
  score: 90,
  findings: [],
};

/**
 * The actual behavior change this feature ships: an agent's linked, enabled
 * skills must flow into `reviewPullRequest` (and hence the persisted
 * `prompt_assembly.skills`), a `manual` skill is concatenated as-is, a
 * non-`manual` skill is `wrapUntrusted`-wrapped, a disabled skill is excluded
 * even though it's still linked, and `token_counts.skills` is populated
 * exactly when there's a skills block to count.
 */
d('Skills wired into a real review run (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
      },
    });
  }

  async function setupRepoAndPr(db: PgFixture['handle']['db']) {
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: `skills-wiring-${Date.now()}`, fullName: `acme/skills-wiring-${Date.now()}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 1,
        title: 'Add a config field',
        author: 'someone',
        branch: 'feat/x',
        base: 'main',
        headSha: 'deadbeef',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    await db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
    return { repo: repo!, pr: pr! };
  }

  it('no linked skills → trace has no Skills block and no token_counts', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'No-skills agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();

    const runRes = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
    ).json();
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (
      await app.inject({ method: 'GET', url: `/runs/${runRes.runs[0].run_id}/trace` })
    ).json();
    expect(trace.prompt_assembly.skills).toBeFalsy();
    expect(trace.prompt_assembly.token_counts).toBeFalsy();
    await app.close();
  });

  it('a manual skill is concatenated as-is; a non-manual skill is wrapUntrusted-wrapped; a disabled linked skill is excluded', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Skilled agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();

    const manualSkill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'Manual Rule', type: 'convention', body: 'Always do X.' },
      })
    ).json();
    const importedSkill = (
      await app.inject({
        method: 'POST',
        url: '/skills/import',
        payload: {
          name: 'Imported Rule',
          type: 'custom',
          body: 'Trust nothing.',
          source: 'imported_url',
        },
      })
    ).json();
    expect(importedSkill.enabled).toBe(false);
    // Vet + enable the imported skill (as a human would via the Skills list),
    // and link a THIRD, still-disabled skill to prove disabled → excluded.
    await app.inject({
      method: 'PUT',
      url: `/skills/${importedSkill.id}`,
      payload: { enabled: true },
    });
    const disabledSkill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'Disabled Rule', type: 'custom', body: 'Should never appear.', enabled: false },
      })
    ).json();

    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [manualSkill.id, importedSkill.id, disabledSkill.id] },
    });

    const runRes = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
    ).json();
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (
      await app.inject({ method: 'GET', url: `/runs/${runRes.runs[0].run_id}/trace` })
    ).json();

    const skillsBlock: string = trace.prompt_assembly.skills;
    expect(skillsBlock).toContain('### Manual Rule');
    expect(skillsBlock).toContain('Always do X.');
    // Non-manual skill is wrapped in the shared untrusted delimiter.
    expect(skillsBlock).toContain('<untrusted source="Imported Rule">');
    expect(skillsBlock).toContain('Trust nothing.');
    // The manual skill's block must NOT be wrapped.
    expect(skillsBlock).not.toContain('<untrusted source="Manual Rule">');
    // The disabled (but still linked) skill never appears at all.
    expect(skillsBlock).not.toContain('Disabled Rule');
    expect(skillsBlock).not.toContain('Should never appear.');

    // Token count reflects the actual skills block, and only appears because
    // there IS a skills block.
    expect(trace.prompt_assembly.token_counts.skills).toBeGreaterThan(0);

    await app.close();
  });

  it('the two seeded new agents have their skills linked, ordered', async () => {
    const app = await makeAppNoOverrides();
    const agents = (await app.inject({ method: 'GET', url: '/agents' })).json();
    const testQuality = agents.find((a: { name: string }) => a.name === 'Test Quality Reviewer');
    const apiContract = agents.find((a: { name: string }) => a.name === 'API Contract Reviewer');
    expect(testQuality).toBeTruthy();
    expect(apiContract).toBeTruthy();

    const tqSkills = (
      await app.inject({ method: 'GET', url: `/agents/${testQuality.id}/skills` })
    ).json();
    expect(tqSkills.length).toBeGreaterThanOrEqual(2);
    expect(tqSkills.map((l: { order: number }) => l.order)).toEqual([...tqSkills]
      .map((l: { order: number }) => l.order)
      .sort((a: number, b: number) => a - b));

    const acSkills = (
      await app.inject({ method: 'GET', url: `/agents/${apiContract.id}/skills` })
    ).json();
    expect(acSkills.length).toBeGreaterThanOrEqual(1);

    // One of Test Quality's skills should carry import provenance, per the
    // acceptance checklist ("at least one skill's seed row looks imported").
    const skillIds: string[] = tqSkills.map((l: { skill_id: string }) => l.skill_id);
    const skills = await Promise.all(
      skillIds.map((id: string) => app.inject({ method: 'GET', url: `/skills/${id}` }).then((r) => r.json())),
    );
    expect(skills.some((s) => s.source !== 'manual')).toBe(true);

    await app.close();
  });

  function makeAppNoOverrides() {
    return buildApp({ config: config(), db: pg.handle.db, overrides: { git: new MockGitClient() } });
  }
});
