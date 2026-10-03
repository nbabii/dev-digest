import { describe, it, expect, vi } from 'vitest';
import type { Container } from '../src/platform/container.js';
import { NotFoundError } from '../src/platform/errors.js';
import { BlastService } from '../src/modules/blast/service.js';
import type {
  BlastPull,
  BlastRepoBasics,
  BlastStore,
  ChangedFilePatch,
} from '../src/modules/blast/repository.js';
import type {
  BlastResult,
  IndexState,
  RepoIntel,
  SymbolRow,
} from '../src/modules/repo-intel/types.js';
import { BlastRadiusReport } from '@devdigest/shared';

const WS = 'ws-1';
const PR = '00000000-0000-0000-0000-0000000000aa';

const pull: BlastPull = { id: PR, repoId: 'repo-1', number: 482, base: 'main', headSha: 'head1' };
const repoBasics: BlastRepoBasics = {
  owner: 'acme',
  name: 'api',
  fullName: 'acme/api',
  defaultBranch: 'main',
};

// ratelimit.ts: touchedFn 5-9 (edited at old line 6), untouchedFn 11-15.
const PATCH = '@@ -5,3 +5,3 @@\n a\n-b\n+B\n c\n';
const symbols: SymbolRow[] = [
  { file: 'src/rl.ts', name: 'touchedFn', kind: 'function', exported: true, startLine: 5, endLine: 9, signature: null, rangeKnown: true },
  { file: 'src/rl.ts', name: 'untouchedFn', kind: 'function', exported: true, startLine: 11, endLine: 15, signature: null, rangeKnown: true },
];

function readyState(over: Partial<IndexState> = {}): IndexState {
  return {
    repoId: 'repo-1',
    status: 'full',
    filesIndexed: 3,
    filesSkipped: 0,
    durationMs: 1,
    lastIndexedSha: 'sha-idx',
    indexerVersion: 2,
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    indexing: false,
    ...over,
  };
}

function blastResult(over: Partial<BlastResult> = {}): BlastResult {
  return {
    changedSymbols: [],
    callers: [
      { file: 'src/api.ts', symbol: 'router', viaSymbol: 'touchedFn', declFile: 'src/rl.ts', line: 23, rank: 1 },
      { file: 'src/job.ts', symbol: 'tick', viaSymbol: 'untouchedFn', declFile: 'src/rl.ts', line: 4, rank: 1 },
    ],
    impactedEndpoints: [],
    factsByFile: {
      'src/api.ts': { endpoints: ['GET /items'], crons: [] },
      'src/job.ts': { endpoints: [], crons: ['0 * * * *'] },
    },
    degraded: false,
    ...over,
  };
}

interface Opts {
  state?: IndexState | Error;
  symbols?: SymbolRow[] | Error;
  blast?: BlastResult | Error;
  prFiles?: ChangedFilePatch[];
  gitRaw?: string | Error;
  githubFiles?: { path: string; patch?: string | null }[] | Error;
  flag?: boolean;
  pull?: BlastPull | null;
  repo?: BlastRepoBasics | null;
}

function build(o: Opts = {}) {
  const getBlastRadius = vi.fn(async () => {
    if (o.blast instanceof Error) throw o.blast;
    return o.blast ?? blastResult();
  });
  const getSymbolsInFiles = vi.fn(async () => {
    if (o.symbols instanceof Error) throw o.symbols;
    return o.symbols ?? symbols;
  });
  const getIndexState = vi.fn(async () => {
    if (o.state instanceof Error) throw o.state;
    return o.state ?? readyState();
  });
  const repoIntel = { getBlastRadius, getSymbolsInFiles, getIndexState } as unknown as RepoIntel;
  const gitDiff = vi.fn(async () => {
    if (o.gitRaw instanceof Error) throw o.gitRaw;
    return { raw: o.gitRaw ?? '', files: [] };
  });
  const getPullRequest = vi.fn(async () => {
    if (o.githubFiles instanceof Error) throw o.githubFiles;
    return { files: o.githubFiles ?? [] };
  });
  const github = vi.fn(async () => ({ getPullRequest }));
  const container = {
    config: { repoIntelEnabled: o.flag ?? true },
    db: {} as never,
    repoIntel,
    git: { diff: gitDiff },
    github,
  } as unknown as Container;
  const calls: string[] = [];
  const store: BlastStore = {
    getPull: async (ws, id) => {
      calls.push(`${ws}:${id}`);
      return ws === WS && id === PR ? (o.pull === undefined ? pull : o.pull) : null;
    },
    getRepoBasics: async () => (o.repo === undefined ? repoBasics : o.repo),
    getChangedFiles: async () => o.prFiles ?? [{ path: 'src/rl.ts', patch: PATCH }],
  };
  const service = new BlastService(container, store);
  return { service, getBlastRadius, getSymbolsInFiles, getIndexState, gitDiff, getPullRequest, github };
}

describe('BlastService', () => {
  it('serves a ready report that parses against the contract, hunk-filtered', async () => {
    const t = build();
    const r = await t.service.getBlastRadius(WS, PR);
    expect(() => BlastRadiusReport.parse(r)).not.toThrow();
    expect(r.index).toMatchObject({ status: 'ready', available: true, facts_complete: true });
    expect(r.changed_files).toMatchObject({ total: 1, covered: 1, source: 'pr_files', without_patch: 0 });
    // untouched symbol never appears and its caller (src/job.ts) + cron are dropped
    expect(r.symbols.map((s) => s.symbol)).toEqual(['touchedFn']);
    expect(r.symbols[0]!.callers).toEqual([
      { name: 'router', file: 'src/api.ts', line: 23, url: 'https://github.com/acme/api/blob/sha-idx/src/api.ts#L23' },
    ]);
    expect(r.symbols[0]!.endpoints_affected).toEqual(['GET /items']);
    expect(r.totals).toEqual({ symbols: 1, callers: 1, endpoints: 1, crons: 0 });
    expect(t.getBlastRadius).toHaveBeenCalledTimes(1);
    expect(t.getBlastRadius).toHaveBeenCalledWith('repo-1', ['src/rl.ts']);
  });

  it('falls back to the default branch for links when the sha is missing', async () => {
    const t = build({ state: readyState({ lastIndexedSha: '' , degradedReason: undefined}) });
    const r = await t.service.getBlastRadius(WS, PR);
    expect(r.symbols[0]!.callers[0]!.url).toContain('/blob/main/');
  });

  describe('index not available => empty report, NEVER calls getBlastRadius (no ripgrep fallback)', () => {
    const cases: [string, Opts, string][] = [
      ['flag off', { flag: false }, 'disabled'],
      [
        'no index row',
        {
          state: readyState({ status: 'degraded', lastIndexedSha: '', degraded: true, degradedReason: 'no_data' }),
        },
        'not_indexed',
      ],
      ['degraded', { state: readyState({ status: 'failed', degraded: true }) }, 'degraded'],
    ];
    it.each(cases)('%s', async (_n, opts, status) => {
      const t = build(opts);
      const r = await t.service.getBlastRadius(WS, PR);
      expect(r.index.status).toBe(status);
      expect(r.index.available).toBe(false);
      expect(r.symbols).toEqual([]);
      expect(r.totals).toEqual({ symbols: 0, callers: 0, endpoints: 0, crons: 0 });
      expect(r.changed_files.total).toBe(1); // still reports the changed files
      expect(t.getBlastRadius).not.toHaveBeenCalled();
      expect(t.getSymbolsInFiles).not.toHaveBeenCalled();
      expect(() => BlastRadiusReport.parse(r)).not.toThrow();
    });
  });

  it('indexing in flight on a usable index still serves data', async () => {
    const r = await build({ state: readyState({ indexing: true }) }).service.getBlastRadius(WS, PR);
    expect(r.index).toMatchObject({ indexing: true, available: true });
    expect(r.symbols).toHaveLength(1);
  });

  it('getBlastRadius answering degraded mid-flight is treated as not available', async () => {
    const t = build({ blast: blastResult({ degraded: true, reason: 'no_data', callers: [] }) });
    const r = await t.service.getBlastRadius(WS, PR);
    expect(r.index).toMatchObject({ status: 'degraded', available: false, reason: 'no_data' });
    expect(r.symbols).toEqual([]);
    expect(r.totals.symbols).toBe(0);
  });

  it('no touched symbol => getBlastRadius is not called; file lands in no_symbol_touched', async () => {
    const t = build({ prFiles: [{ path: 'src/rl.ts', patch: '@@ -1,2 +1,2 @@\n-import a\n+import b\n x\n' }] });
    const r = await t.service.getBlastRadius(WS, PR);
    expect(t.getBlastRadius).not.toHaveBeenCalled();
    expect(r.symbols).toEqual([]);
    expect(r.changed_files.no_symbol_touched).toEqual(['src/rl.ts']);
    expect(r.changed_files.covered).toBe(1);
  });

  it('a file without a patch uses the match:file fallback and is counted', async () => {
    const t = build({ prFiles: [{ path: 'src/rl.ts', patch: null }] });
    const r = await t.service.getBlastRadius(WS, PR);
    expect(r.changed_files.without_patch).toBe(1);
    expect(r.symbols.map((s) => `${s.symbol}:${s.match}`).sort()).toEqual(['touchedFn:file', 'untouchedFn:file']);
  });

  it('files without index symbols are uncovered', async () => {
    const t = build({
      prFiles: [
        { path: 'src/rl.ts', patch: PATCH },
        { path: 'src/new.ts', patch: '@@ -0,0 +1,1 @@\n+x\n' },
      ],
    });
    const r = await t.service.getBlastRadius(WS, PR);
    expect(r.changed_files).toMatchObject({ total: 2, covered: 1, uncovered: ['src/new.ts'] });
  });

  describe('changed-file tier fallthrough', () => {
    const gitRaw = 'diff --git a/src/rl.ts b/src/rl.ts\n--- a/src/rl.ts\n+++ b/src/rl.ts\n' + PATCH;

    it('pr_files first (git/github untouched)', async () => {
      const t = build();
      const r = await t.service.getBlastRadius(WS, PR);
      expect(r.changed_files.source).toBe('pr_files');
      expect(t.gitDiff).not.toHaveBeenCalled();
      expect(t.github).not.toHaveBeenCalled();
    });
    it('then git diff', async () => {
      const t = build({ prFiles: [], gitRaw });
      const r = await t.service.getBlastRadius(WS, PR);
      expect(r.changed_files.source).toBe('git');
      expect(r.symbols.map((s) => s.symbol)).toEqual(['touchedFn']);
      expect(t.github).not.toHaveBeenCalled();
    });
    it('then github (git throws or is empty)', async () => {
      for (const git of [new Error('no clone'), '']) {
        const t = build({ prFiles: [], gitRaw: git, githubFiles: [{ path: 'src/rl.ts', patch: PATCH }] });
        const r = await t.service.getBlastRadius(WS, PR);
        expect(r.changed_files.source).toBe('github');
        expect(r.symbols.map((s) => s.symbol)).toEqual(['touchedFn']);
      }
    });
    it('then none (everything empty / failing) without erroring', async () => {
      const t = build({ prFiles: [], gitRaw: new Error('x'), githubFiles: new Error('no token') });
      const r = await t.service.getBlastRadius(WS, PR);
      expect(r.changed_files).toMatchObject({ total: 0, source: 'none' });
      expect(r.symbols).toEqual([]);
      expect(t.getBlastRadius).not.toHaveBeenCalled();
    });
  });

  it('caps the changed-file list and reports truncated', async () => {
    const many = Array.from({ length: 1005 }, (_, i) => ({ path: `f${i}.ts`, patch: null }));
    const r = await build({ prFiles: many }).service.getBlastRadius(WS, PR);
    expect(r.changed_files).toMatchObject({ total: 1000, truncated: true });
  });

  describe('facade failures never become a 500', () => {
    it.each([
      ['getIndexState throws', { state: new Error('db down') }],
      ['getSymbolsInFiles throws', { symbols: new Error('db down') }],
      ['getBlastRadius throws', { blast: new Error('db down') }],
    ] as [string, Opts][])('%s', async (_n, opts) => {
      const r = await build(opts).service.getBlastRadius(WS, PR);
      expect(r.index).toMatchObject({ status: 'degraded', available: false, reason: 'read_failed' });
      expect(r.symbols).toEqual([]);
      expect(() => BlastRadiusReport.parse(r)).not.toThrow();
    });
  });

  it('404 for an unknown PR, another workspace, or a missing repo', async () => {
    const t = build();
    await expect(t.service.getBlastRadius(WS, '00000000-0000-0000-0000-0000000000bb')).rejects.toBeInstanceOf(NotFoundError);
    await expect(t.service.getBlastRadius('other-ws', PR)).rejects.toBeInstanceOf(NotFoundError);
    await expect(build({ repo: null }).service.getBlastRadius(WS, PR)).rejects.toBeInstanceOf(NotFoundError);
    expect(t.getIndexState).not.toHaveBeenCalled();
  });

  it('logs one structured line with counts only', async () => {
    const info = vi.fn();
    await build().service.getBlastRadius(WS, PR, { info });
    expect(info).toHaveBeenCalledTimes(1);
    const [obj] = info.mock.calls[0]!;
    expect(Object.keys(obj).sort()).toEqual(
      ['callers', 'changedFiles', 'indexStatus', 'indexing', 'prId', 'source', 'symbols'].sort(),
    );
  });
});
