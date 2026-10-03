/**
 * GET /pulls/:id/blast-radius — DB-backed (Testcontainers pg). Runs against the
 * seeded demo repo (acme/payments-api, PR #482) whose repo-intel index is seeded
 * unconditionally (see db/seed.ts). No LLM and no network: git/github are mocks.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { BlastRadiusReport } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('GET /pulls/:id/blast-radius (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let prId: string;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    await seed(pg.handle.db); // idempotent: a second run must not duplicate index rows
    const db = pg.handle.db;
    const [pr] = await db.select().from(t.pullRequests).where(eq(t.pullRequests.number, 482));
    prId = pr!.id;
    workspaceId = pr!.workspaceId;
    app = await buildApp({
      config: config(),
      db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  const get = (id: string) => app.inject({ method: 'GET', url: `/pulls/${id}/blast-radius` });

  it('PR #482: parses with the contract; rateLimit/bucketKey with callers, endpoint and cron chips', async () => {
    const res = await get(prId);
    expect(res.statusCode).toBe(200);
    const report = BlastRadiusReport.parse(res.json());

    expect(report.repo).toBe('acme/payments-api');
    expect(report.pr_number).toBe(482);
    expect(report.index).toMatchObject({ status: 'ready', available: true, facts_complete: true });
    expect(report.changed_files.source).toBe('pr_files');

    const bySym = Object.fromEntries(report.symbols.map((s) => [s.symbol, s]));
    expect(Object.keys(bySym).sort()).toEqual(['bucketKey', 'rateLimit']);
    expect(report.symbols.every((s) => s.match === 'hunk')).toBe(true);

    const rl = bySym['rateLimit']!;
    expect(rl.callers.map((c) => `${c.file}:${c.line}`)).toEqual([
      'src/api/public/index.ts:23',
      'src/api/router.ts:41',
    ]);
    expect(rl.callers[0]!.url).toBe(
      'https://github.com/acme/payments-api/blob/a1b2c3d4e5f60718293a4b5c6d7e8f9012345678/src/api/public/index.ts#L23',
    );
    expect(rl.endpoints_affected).toEqual([
      'GET /api/public/health',
      'GET /api/public/items',
      'POST /api/public/webhooks',
    ]);
    expect(bySym['bucketKey']!.crons_affected).toEqual(['reset-buckets (hourly)']);
    expect(report.totals).toMatchObject({ symbols: 2, endpoints: 3, crons: 1 });
    expect(report.totals.callers).toBe(3);
  });

  it('does NOT show the seeded untouched symbol (resetBuckets) nor its caller', async () => {
    const report = BlastRadiusReport.parse((await get(prId)).json());
    expect(report.symbols.map((s) => s.symbol)).not.toContain('resetBuckets');
    // resetBuckets' only caller is the cron file; it appears solely via bucketKey.
    const rl = report.symbols.find((s) => s.symbol === 'rateLimit')!;
    expect(rl.callers.some((c) => c.file === 'src/jobs/reset-buckets.ts')).toBe(false);
    expect(rl.crons_affected).toEqual([]);
  });

  it('lists the symbol-less changed files as uncovered (webhooks.ts, config.ts, users.ts)', async () => {
    const report = BlastRadiusReport.parse((await get(prId)).json());
    expect(report.changed_files).toMatchObject({ total: 4, covered: 1 });
    expect(report.changed_files.uncovered.sort()).toEqual([
      'src/api/public/webhooks.ts',
      'src/api/users.ts',
      'src/config.ts',
    ]);
  });

  it('seed is idempotent: one index row, no duplicate symbols', async () => {
    const syms = await pg.handle.db
      .select({ id: t.symbols.id })
      .from(t.symbols)
      .where(eq(t.symbols.path, 'src/middleware/ratelimit.ts'));
    expect(syms).toHaveLength(3);
    const states = await pg.handle.db.select().from(t.repoIndexState);
    expect(states).toHaveLength(1);
  });

  it('a repo with no index row returns not_indexed with an empty map', async () => {
    const db = pg.handle.db;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'unindexed', fullName: 'acme/unindexed' })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 1,
        title: 'x',
        author: 'a',
        branch: 'b',
        base: 'main',
        headSha: 'h',
        status: 'open',
      })
      .returning();
    await db.insert(t.prFiles).values({ prId: pr!.id, path: 'src/a.ts', patch: '@@ -1,1 +1,1 @@\n-a\n+b\n' });
    const res = await get(pr!.id);
    expect(res.statusCode).toBe(200);
    const report = BlastRadiusReport.parse(res.json());
    expect(report.index).toMatchObject({ status: 'not_indexed', available: false });
    expect(report.symbols).toEqual([]);
    expect(report.changed_files.total).toBe(1);
  });

  it('an active resync job on an indexed repo reports indexing:true and still serves data', async () => {
    const db = pg.handle.db;
    const [repo] = await db.select().from(t.repos).where(and(eq(t.repos.fullName, 'acme/payments-api')));
    await db.insert(t.jobs).values({
      workspaceId,
      kind: 'repo-intel-resync',
      payload: { repoId: repo!.id },
      status: 'running',
    });
    const report = BlastRadiusReport.parse((await get(prId)).json());
    expect(report.index).toMatchObject({ status: 'ready', indexing: true, available: true });
    expect(report.symbols.length).toBe(2);
  });

  it('unknown uuid -> 404, malformed id -> 422', async () => {
    expect((await get('00000000-0000-0000-0000-000000000000')).statusCode).toBe(404);
    expect((await get('not-a-uuid')).statusCode).toBe(422);
  });
});
