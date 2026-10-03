import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import { RepoIntelRepository } from '../src/modules/repo-intel/repository.js';
import type { ResolvedCallerRow } from '../src/modules/repo-intel/repository.js';
import type { IndexState } from '../src/modules/repo-intel/types.js';
import { BLAST_MAX_CALLER_ROWS, MAX_CALLERS_PER_SYMBOL } from '../src/modules/repo-intel/constants.js';

/**
 * Blast-facing facade changes (docs/plans/blast-radius.md, facade task):
 * no global caller slice, `declFile` on caller rows, `callersTruncated` at the
 * SQL row cap, `IndexState.indexing`, and the partial-index `reason`
 * projection. Hermetic: the repository is patched / given a fake db chain.
 */

const fullState: IndexState = {
  repoId: 'r1',
  status: 'full',
  filesIndexed: 3,
  filesSkipped: 0,
  durationMs: 1,
  lastIndexedSha: 'sha',
  indexerVersion: 2,
  updatedAt: new Date(0),
};

function build(opts: {
  flag?: boolean;
  state?: IndexState | null;
  callers?: ResolvedCallerRow[];
  indexing?: boolean;
}): RepoIntelService {
  const container = {
    config: { repoIntelEnabled: opts.flag ?? true },
    db: {} as never,
    codeIndex: { symbols: async () => [], references: async () => [] } as never,
  } as never;
  const svc = new RepoIntelService(container);
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    getRepoBasics: async () => null,
    tryGetIndexState: async () => (opts.state === undefined ? fullState : opts.state),
    hasActiveIndexJob: async () => opts.indexing ?? false,
    getSymbolRows: async (_r: string, paths: string[]) =>
      paths.includes('src/decl.ts')
        ? [{ path: 'src/decl.ts', name: 'f', kind: 'function', line: 1, endLine: 5, exported: true, signature: null }]
        : [],
    getResolvedCallers: async () => opts.callers ?? [],
    getFileFacts: async () => [],
  };
  return svc;
}

const rows = (n: number): ResolvedCallerRow[] =>
  Array.from({ length: n }, (_, i) => ({
    fromPath: `src/c${i}.ts`,
    toSymbol: 'f',
    declFile: 'src/decl.ts',
    line: i + 1,
    rank: 1 / (i + 1),
  }));

describe('RepoIntel.getBlastRadius (persistent path)', () => {
  it('does not apply a global caller slice (cap is per symbol, in the consumer)', async () => {
    const n = MAX_CALLERS_PER_SYMBOL + 5;
    const r = await build({ callers: rows(n) }).getBlastRadius('r1', ['src/decl.ts']);
    expect(r.degraded).toBe(false);
    expect(r.callers).toHaveLength(n);
    expect(r.callersTruncated).toBe(false);
  });

  it('carries declFile on every caller row', async () => {
    const r = await build({ callers: rows(3) }).getBlastRadius('r1', ['src/decl.ts']);
    expect(r.callers.every((c) => c.declFile === 'src/decl.ts')).toBe(true);
  });

  it('keeps callers from two decl files with the same symbol name apart', async () => {
    const callers: ResolvedCallerRow[] = [
      { fromPath: 'src/x.ts', toSymbol: 'f', declFile: 'src/decl.ts', line: 1, rank: 1 },
      { fromPath: 'src/x.ts', toSymbol: 'f', declFile: 'src/other.ts', line: 2, rank: 1 },
    ];
    const r = await build({ callers }).getBlastRadius('r1', ['src/decl.ts']);
    expect(r.callers.map((c) => c.declFile).sort()).toEqual(['src/decl.ts', 'src/other.ts']);
  });

  it('orders by rank desc', async () => {
    const callers: ResolvedCallerRow[] = [
      { fromPath: 'src/low.ts', toSymbol: 'f', declFile: 'src/decl.ts', line: 1, rank: 0.1 },
      { fromPath: 'src/high.ts', toSymbol: 'f', declFile: 'src/decl.ts', line: 1, rank: 0.9 },
    ];
    const r = await build({ callers }).getBlastRadius('r1', ['src/decl.ts']);
    expect(r.callers.map((c) => c.file)).toEqual(['src/high.ts', 'src/low.ts']);
  });

  it('sets callersTruncated when the SQL row cap is hit', async () => {
    const r = await build({ callers: rows(BLAST_MAX_CALLER_ROWS) }).getBlastRadius('r1', ['src/decl.ts']);
    expect(r.callersTruncated).toBe(true);
  });
});

describe('RepoIntel.getIndexState', () => {
  it('sets indexing from the active-job probe', async () => {
    expect((await build({ indexing: true }).getIndexState('r1')).indexing).toBe(true);
    expect((await build({ indexing: false }).getIndexState('r1')).indexing).toBe(false);
  });

  it('unchanged degraded contract with no row (flag off): synthesised, never throws', async () => {
    const s = await build({ flag: false, state: null }).getIndexState('r1');
    expect(s).toMatchObject({ repoId: 'r1', status: 'degraded', lastIndexedSha: '', degraded: true });
    expect(s.indexing).toBeUndefined();
  });
});

/** Minimal drizzle-ish chain: select().from().where() resolves rows (and .limit()). */
function fakeDb(result: unknown[] | Error) {
  const settle = () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result));
  // Lazy thenable: a rejection is only created when the chain is awaited.
  const where = () => ({
    limit: settle,
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => settle().then(res, rej),
  });
  return { select: () => ({ from: () => ({ where }) }) } as never;
}

describe('RepoIntelRepository.tryGetIndexState reason projection', () => {
  const row = (status: string, stats: Record<string, unknown>) => ({
    repoId: 'r1',
    lastIndexedSha: 'sha',
    indexerVersion: 2,
    status,
    filesIndexed: 1,
    filesSkipped: 0,
    stats,
    updatedAt: new Date(0),
  });

  it.each([
    [{ softBudgetReached: true }, 'soft_budget'],
    [{ graphFailed: true }, 'graph_failed'],
    [{ softBudgetReached: true, graphFailed: true }, 'soft_budget'],
    [{ reason: 'custom', softBudgetReached: true }, 'custom'],
    [{}, undefined],
  ])('stats %j -> reason %s', async (stats, expected) => {
    const repo = new RepoIntelRepository(fakeDb([row('partial', stats)]));
    const s = await repo.tryGetIndexState('r1');
    expect(s?.reason).toBe(expected);
    expect(s?.status).toBe('partial');
  });
});

describe('RepoIntelRepository.hasActiveIndexJob', () => {
  it('true when a queued/running job row exists, false otherwise', async () => {
    expect(await new RepoIntelRepository(fakeDb([{ id: 'j' }])).hasActiveIndexJob('r1')).toBe(true);
    expect(await new RepoIntelRepository(fakeDb([])).hasActiveIndexJob('r1')).toBe(false);
  });
  it('swallows errors and returns false', async () => {
    expect(await new RepoIntelRepository(fakeDb(new Error('boom'))).hasActiveIndexJob('r1')).toBe(false);
  });
});
