import { describe, it, expect } from 'vitest';
import type { BlastCallerRow, IndexState, SymbolRow } from '../src/modules/repo-intel/types.js';
import {
  blobUrl,
  dedupeCandidates,
  deriveIndex,
  formatCron,
  groupBlast,
  humanizeCron,
  selectTouchedSymbols,
  splitRawDiff,
  touchedBaseLines,
  type TouchedLines,
  type TouchedSymbol,
} from '../src/modules/blast/helpers.js';
import {
  MAX_CALLERS_PER_SYMBOL,
  MAX_SYMBOLS,
} from '../src/modules/blast/constants.js';

function state(over: Partial<IndexState> = {}): IndexState {
  return {
    repoId: 'r1',
    status: 'full',
    filesIndexed: 10,
    filesSkipped: 0,
    durationMs: 1,
    lastIndexedSha: 'abc123',
    indexerVersion: 2,
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...over,
  };
}

describe('deriveIndex', () => {
  it('flag off -> disabled', () => {
    const i = deriveIndex({ flagEnabled: false, state: state() });
    expect(i).toMatchObject({ status: 'disabled', available: false, last_indexed_sha: null });
  });
  it('no row (null or synthesised) -> not_indexed', () => {
    expect(deriveIndex({ flagEnabled: true, state: null }).status).toBe('not_indexed');
    const synth = state({
      status: 'degraded',
      lastIndexedSha: '',
      degraded: true,
      degradedReason: 'no_data',
      reason: 'no_data',
    });
    const i = deriveIndex({ flagEnabled: true, state: synth });
    expect(i).toMatchObject({ status: 'not_indexed', available: false, reason: null });
  });
  it('full -> ready, facts complete, ISO indexed_at', () => {
    const i = deriveIndex({ flagEnabled: true, state: state() });
    expect(i).toEqual({
      status: 'ready',
      indexing: false,
      available: true,
      reason: null,
      facts_complete: true,
      last_indexed_sha: 'abc123',
      indexed_at: '2026-10-01T00:00:00.000Z',
    });
  });
  it('partial + soft_budget / graph_failed -> available but facts incomplete', () => {
    for (const reason of ['soft_budget', 'graph_failed']) {
      const i = deriveIndex({ flagEnabled: true, state: state({ status: 'partial', reason }) });
      expect(i).toMatchObject({ status: 'partial', available: true, facts_complete: false, reason });
    }
  });
  it('partial with another reason keeps facts complete', () => {
    const i = deriveIndex({
      flagEnabled: true,
      state: state({ status: 'partial', reason: 'parse_errors' }),
    });
    expect(i.facts_complete).toBe(true);
  });
  it('degraded / failed -> degraded, unavailable', () => {
    for (const status of ['degraded', 'failed'] as const) {
      const i = deriveIndex({
        flagEnabled: true,
        state: state({ status, degraded: true, degradedReason: 'index_failed' }),
      });
      expect(i).toMatchObject({
        status: 'degraded',
        available: false,
        facts_complete: false,
        reason: 'index_failed',
      });
    }
  });
  it('indexing flag passes through (true/false/undefined)', () => {
    expect(deriveIndex({ flagEnabled: true, state: state({ indexing: true }) }).indexing).toBe(true);
    expect(deriveIndex({ flagEnabled: true, state: state({ indexing: false }) }).indexing).toBe(false);
    expect(deriveIndex({ flagEnabled: true, state: state() }).indexing).toBe(false);
  });
});

describe('touchedBaseLines', () => {
  it('removed lines use OLD-side numbers; context only advances', () => {
    const t = touchedBaseLines('@@ -10,4 +10,3 @@\n a\n-b\n-c\n d\n');
    expect([...t.lines]).toEqual([11, 12]);
    expect(t.insertions).toEqual([]);
  });
  it('insertion boundary = last old line before a run of + (once per run)', () => {
    const t = touchedBaseLines('@@ -5,2 +5,4 @@\n a\n+x\n+y\n b\n');
    expect(t.lines.size).toBe(0);
    expect(t.insertions).toEqual([5]);
  });
  it('pure insertion hunk (-N,0) inserts after line N', () => {
    const t = touchedBaseLines('@@ -7,0 +8,2 @@\n+x\n+y\n');
    expect(t.insertions).toEqual([7]);
  });
  it('multi-hunk patch with shifting old cursor', () => {
    const patch =
      '@@ -1,2 +1,3 @@\n a\n+ins\n b\n' + // old lines 1..2
      '@@ -20,3 +21,2 @@\n x\n-y\n z\n';
    const t = touchedBaseLines(patch);
    expect(t.insertions).toEqual([1]);
    expect([...t.lines]).toEqual([21]);
  });
  it('ignores "\\ No newline" markers and text before the first hunk', () => {
    const t = touchedBaseLines('--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-a\n\\ No newline at end of file\n+b\n');
    expect([...t.lines]).toEqual([1]);
  });
});

describe('splitRawDiff', () => {
  it('splits per file by old path; binary -> null patch', () => {
    const raw =
      'diff --git a/src/a.ts b/src/a.ts\nindex 1..2 100644\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-x\n+y\n' +
      'diff --git a/img.png b/img.png\nBinary files a/img.png and b/img.png differ\n' +
      'diff --git a/gone.ts b/gone.ts\ndeleted file mode 100644\n--- a/gone.ts\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n';
    const files = splitRawDiff(raw);
    expect(files.map((f) => f.path)).toEqual(['src/a.ts', 'img.png', 'gone.ts']);
    expect(files[0]!.patch!.startsWith('@@ -1,1')).toBe(true);
    expect(files[1]!.patch).toBeNull();
    expect([...touchedBaseLines(files[2]!.patch!).lines]).toEqual([1, 2]);
  });
});

function sym(over: Partial<SymbolRow> & Pick<SymbolRow, 'name'>): SymbolRow {
  return {
    file: 'src/a.ts',
    kind: 'function',
    exported: true,
    startLine: 1,
    endLine: 1,
    signature: null,
    rangeKnown: true,
    ...over,
  };
}

function touched(lines: number[], insertions: number[] = []): TouchedLines {
  return { lines: new Set(lines), insertions };
}

const names = (r: ReturnType<typeof selectTouchedSymbols>) =>
  r.touched.map((t) => `${t.symbol.name}:${t.match}`).sort();

describe('selectTouchedSymbols', () => {
  const f = sym({ name: 'f', startLine: 10, endLine: 20 });
  const g = sym({ name: 'g', startLine: 21, endLine: 30 });
  const sel = (cands: SymbolRow[], t: TouchedLines | null, file = 'src/a.ts') =>
    selectTouchedSymbols(cands, new Map([[file, t]]));

  it('edit / deletion inside body matches', () => {
    expect(names(sel([f, g], touched([15])))).toEqual(['f:hunk']);
    expect(names(sel([f, g], touched([10])))).toEqual(['f:hunk']); // signature line
    expect(names(sel([f, g], touched([20])))).toEqual(['f:hunk']); // closing line
  });
  it('insertion strictly inside the body matches', () => {
    expect(names(sel([f], touched([], [15])))).toEqual(['f:hunk']);
    expect(names(sel([f], touched([], [10])))).toEqual(['f:hunk']); // right after signature
  });
  it('lines appended right after end_line do NOT match', () => {
    const r = sel([f], touched([], [20]));
    expect(r.touched).toEqual([]);
    expect(r.noSymbolTouched).toEqual(['src/a.ts']);
  });
  it('insertion before the first line does not match', () => {
    expect(sel([f], touched([], [9])).touched).toEqual([]);
  });
  it('context-only lines never match (empty touched set)', () => {
    expect(sel([f, g], touched([])).touched).toEqual([]);
  });
  it('change spanning two adjacent functions matches both', () => {
    expect(names(sel([f, g], touched([20, 21])))).toEqual(['f:hunk', 'g:hunk']);
  });
  it('method edit matches the method and its enclosing class', () => {
    const cls = sym({ name: 'Svc', kind: 'class', startLine: 1, endLine: 50 });
    const m = sym({ name: 'run', kind: 'method', startLine: 10, endLine: 20 });
    const other = sym({ name: 'stop', kind: 'method', startLine: 22, endLine: 30 });
    expect(names(sel([cls, m, other], touched([12])))).toEqual(['Svc:hunk', 'run:hunk']);
  });
  it('deleted file (every old line removed) matches all symbols', () => {
    const all = touched(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(names(sel([f, g], all))).toEqual(['f:hunk', 'g:hunk']);
  });
  it('patch: null gives every symbol with match:file', () => {
    const r = sel([f, g], null);
    expect(names(r)).toEqual(['f:file', 'g:file']);
    expect(r.withoutPatch).toEqual(['src/a.ts']);
  });
  it('missing map entry behaves like no patch', () => {
    const r = selectTouchedSymbols([f], new Map());
    expect(names(r)).toEqual(['f:file']);
  });
  it('unknown ranges for every symbol -> match:file', () => {
    const old = [
      sym({ name: 'f', startLine: 0, endLine: 0, rangeKnown: false }),
      sym({ name: 'g', startLine: 5, endLine: 5, rangeKnown: false }),
    ];
    const r = sel(old, touched([100]));
    expect(names(r)).toEqual(['f:file', 'g:file']);
    expect(r.withoutPatch).toEqual(['src/a.ts']);
  });
  it('covered file with only an import change -> no_symbol_touched', () => {
    const r = sel([f, g], touched([2], [1]));
    expect(r.touched).toEqual([]);
    expect(r.noSymbolTouched).toEqual(['src/a.ts']);
    expect(r.withoutPatch).toEqual([]);
  });
  it('is evaluated per file', () => {
    const b = sym({ name: 'h', file: 'src/b.ts', startLine: 1, endLine: 5 });
    const r = selectTouchedSymbols(
      [f, b],
      new Map<string, TouchedLines | null>([
        ['src/a.ts', touched([12])],
        ['src/b.ts', null],
      ]),
    );
    expect(names(r)).toEqual(['f:hunk', 'h:file']);
  });
});

describe('dedupeCandidates', () => {
  it('drops dotted names, dedupes by (file,name), prefers callable then lowest line', () => {
    const rows = [
      sym({ name: 'Svc.run', kind: 'method', startLine: 5 }),
      sym({ name: 'run', kind: 'method', startLine: 5 }),
      sym({ name: 'X', kind: 'type', startLine: 1 }),
      sym({ name: 'X', kind: 'function', startLine: 9 }),
      sym({ name: 'Y', kind: 'function', startLine: 9 }),
      sym({ name: 'Y', kind: 'function', startLine: 3 }),
      sym({ name: 'Y', file: 'src/b.ts', kind: 'function', startLine: 7 }),
    ];
    const out = dedupeCandidates(rows);
    const key = (r: SymbolRow) => `${r.file}:${r.name}:${r.kind}:${r.startLine}`;
    expect(out.map(key).sort()).toEqual(
      [
        'src/a.ts:run:method:5',
        'src/a.ts:X:function:9',
        'src/a.ts:Y:function:3',
        'src/b.ts:Y:function:7',
      ].sort(),
    );
  });
});

describe('groupBlast', () => {
  const caller = (over: Partial<BlastCallerRow> & Pick<BlastCallerRow, 'file' | 'viaSymbol'>): BlastCallerRow => ({
    symbol: 'caller',
    declFile: 'src/a.ts',
    line: 1,
    rank: 0,
    ...over,
  });
  const t = (s: SymbolRow, match: 'hunk' | 'file' = 'hunk'): TouchedSymbol => ({ symbol: s, match });
  const base = { fullName: 'acme/api', ref: 'sha1', factsByFile: {} };

  it('groups by declFile + name: same symbol name in two files stays separate', () => {
    const a = sym({ name: 'init', file: 'src/a.ts', startLine: 1 });
    const b = sym({ name: 'init', file: 'src/b.ts', startLine: 1 });
    const r = groupBlast({
      ...base,
      touched: [t(a), t(b)],
      callers: [
        caller({ file: 'x.ts', viaSymbol: 'init', declFile: 'src/a.ts' }),
        caller({ file: 'y.ts', viaSymbol: 'init', declFile: 'src/b.ts' }),
        caller({ file: 'z.ts', viaSymbol: 'init', declFile: 'src/b.ts' }),
      ],
    });
    const byFile = Object.fromEntries(r.symbols.map((s) => [s.file, s.callers.map((c) => c.file)]));
    expect(byFile['src/a.ts']).toEqual(['x.ts']);
    expect(byFile['src/b.ts']).toEqual(['y.ts', 'z.ts']);
  });

  it('callers of untouched symbols and rows without declFile are dropped', () => {
    const a = sym({ name: 'f' });
    const r = groupBlast({
      ...base,
      touched: [t(a)],
      callers: [
        caller({ file: 'x.ts', viaSymbol: 'other' }),
        caller({ file: 'y.ts', viaSymbol: 'f', declFile: undefined }),
      ],
    });
    expect(r.symbols[0]!.callers).toEqual([]);
    expect(r.totals.callers).toBe(0);
  });

  it('dedupes per (file, enclosing symbol) keeping the lowest line; builds urls', () => {
    const a = sym({ name: 'f' });
    const r = groupBlast({
      ...base,
      touched: [t(a)],
      callers: [
        caller({ file: 'x.ts', viaSymbol: 'f', symbol: 'h', line: 9 }),
        caller({ file: 'x.ts', viaSymbol: 'f', symbol: 'h', line: 4 }),
      ],
    });
    expect(r.symbols[0]!.callers).toEqual([
      { name: 'h', file: 'x.ts', line: 4, url: 'https://github.com/acme/api/blob/sha1/x.ts#L4' },
    ]);
    expect(r.symbols[0]!.callers_total).toBe(1);
  });

  it('per-symbol caps keep pre-cap totals and flag truncation', () => {
    const a = sym({ name: 'f' });
    const rows = Array.from({ length: MAX_CALLERS_PER_SYMBOL + 5 }, (_, i) =>
      caller({ file: `c${String(i).padStart(3, '0')}.ts`, viaSymbol: 'f' }),
    );
    const facts: Record<string, { endpoints: string[]; crons: string[] }> = {};
    for (let i = 0; i < 40; i++) {
      facts[`c${String(i).padStart(3, '0')}.ts`] = { endpoints: [`GET /e${i}`], crons: [] };
    }
    const r = groupBlast({ ...base, factsByFile: facts, touched: [t(a)], callers: rows });
    const s = r.symbols[0]!;
    expect(s.callers).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(s.callers_total).toBe(MAX_CALLERS_PER_SYMBOL + 5);
    expect(s.endpoints_total).toBe(MAX_CALLERS_PER_SYMBOL + 5); // union over ALL callers, pre-cap
    expect(r.totals.callers).toBe(MAX_CALLERS_PER_SYMBOL + 5);
    expect(r.limits.callers_truncated).toBe(true);
    expect(r.limits.symbols_truncated).toBe(false);
  });

  it('rowCapHit marks callers_truncated even when nothing is capped per symbol', () => {
    const r = groupBlast({ ...base, touched: [t(sym({ name: 'f' }))], callers: [], rowCapHit: true });
    expect(r.limits.callers_truncated).toBe(true);
  });

  it('symbol cap: totals.symbols is pre-cap', () => {
    const many = Array.from({ length: MAX_SYMBOLS + 3 }, (_, i) =>
      t(sym({ name: `s${String(i).padStart(2, '0')}`, startLine: i + 1, endLine: i + 1 })),
    );
    const r = groupBlast({ ...base, touched: many, callers: [] });
    expect(r.symbols).toHaveLength(MAX_SYMBOLS);
    expect(r.totals.symbols).toBe(MAX_SYMBOLS + 3);
    expect(r.limits.symbols_truncated).toBe(true);
  });

  it('totals are DISTINCT: a caller reaching two symbols counts once; shared endpoints once', () => {
    const f = sym({ name: 'f', startLine: 1, endLine: 2 });
    const g = sym({ name: 'g', startLine: 3, endLine: 4 });
    const r = groupBlast({
      ...base,
      factsByFile: { 'x.ts': { endpoints: ['GET /a'], crons: ['0 * * * *'] } },
      touched: [t(f), t(g)],
      callers: [
        caller({ file: 'x.ts', viaSymbol: 'f', symbol: 'h' }),
        caller({ file: 'x.ts', viaSymbol: 'g', symbol: 'h' }),
      ],
    });
    expect(r.totals).toEqual({ symbols: 2, callers: 1, endpoints: 1, crons: 1 });
    expect(r.symbols.every((s) => s.endpoints_affected.join() === 'GET /a')).toBe(true);
    expect(r.symbols[0]!.crons_affected).toEqual(['x (hourly)']);
  });

  it('sorts hunk before file, then callers desc, exported first, file, line, name (stable)', () => {
    const mk = (name: string, over: Partial<SymbolRow> = {}) => sym({ name, ...over });
    const touchedList: TouchedSymbol[] = [
      t(mk('fileMatch'), 'file'),
      t(mk('noCallers', { startLine: 5 })),
      t(mk('manyCallers', { startLine: 6 })),
      t(mk('privB', { exported: false, file: 'src/a.ts', startLine: 7 })),
      t(mk('pubZ', { exported: true, file: 'src/z.ts', startLine: 1 })),
      t(mk('pubA', { exported: true, file: 'src/a.ts', startLine: 9 })),
    ];
    const run = (list: TouchedSymbol[]) =>
      groupBlast({
        ...base,
        touched: list,
        callers: [
          caller({ file: 'x.ts', viaSymbol: 'manyCallers', symbol: 'a' }),
          caller({ file: 'y.ts', viaSymbol: 'manyCallers', symbol: 'b' }),
        ],
      }).symbols.map((s) => s.symbol);
    // Ties at 0 callers: exported first, then file, then line (noCallers=a:5, pubA=a:9, pubZ=z:1).
    expect(run(touchedList)).toEqual(['manyCallers', 'noCallers', 'pubA', 'pubZ', 'privB', 'fileMatch']);
    expect(run([...touchedList].reverse())).toEqual(run(touchedList));
  });

  it('duplicate (file,name) keeps the stronger match and counts once', () => {
    const a = sym({ name: 'f' });
    const r = groupBlast({ ...base, touched: [t(a, 'file'), t(a, 'hunk')], callers: [] });
    expect(r.symbols).toHaveLength(1);
    expect(r.symbols[0]!.match).toBe('hunk');
    expect(r.totals.symbols).toBe(1);
  });

  it('line is null when the index has no start line', () => {
    const r = groupBlast({ ...base, touched: [t(sym({ name: 'f', startLine: 0, endLine: 0 }), 'file')], callers: [] });
    expect(r.symbols[0]!.line).toBeNull();
  });
});

describe('formatCron / humanizeCron', () => {
  it.each([
    ['job:poll_repos', 'src/jobs/x.ts', 'poll_repos'],
    ['0 * * * *', 'src/jobs/reset-buckets.ts', 'reset-buckets (hourly)'],
    ['*/15 * * * *', 'src/jobs/sync.ts', 'sync (every 15 min)'],
    ['0 0 * * *', 'a/b/digest.js', 'digest (daily)'],
    ['0 9 * * 1', 'weekly.ts', 'weekly (weekly)'],
    ['0 0 1 * *', 'm.ts', 'm (monthly)'],
    ['0 */6 * * *', 'h.ts', 'h (every 6 h)'],
    ['@weekly', 'w.ts', 'w (@weekly)'],
    ['1 2 3 4 5 6', 'w.ts', 'w (1 2 3 4 5 6)'],
  ])('formatCron(%s, %s) = %s', (raw, file, out) => {
    expect(formatCron(raw, file)).toBe(out);
  });
  it('humanizeCron falls back to the raw expression', () => {
    expect(humanizeCron('5-10 * * * *')).toBe('5-10 * * * *');
    expect(humanizeCron('* * * * *')).toBe('every min');
  });
});

describe('blobUrl', () => {
  it('encodes # ? spaces and unicode per segment, keeps slashes', () => {
    expect(blobUrl('acme/api', 'sha', 'src/a b/c#d?.ts', 3)).toBe(
      'https://github.com/acme/api/blob/sha/src/a%20b/c%23d%3F.ts#L3',
    );
    expect(blobUrl('acme/api', 'sha', 'src/ü.ts', 1)).toContain('/src/%C3%BC.ts#L1');
  });
  it('neutralises . and .. segments', () => {
    const u = blobUrl('acme/api', 'sha', '../../etc/./passwd', 1);
    expect(u).toBe('https://github.com/acme/api/blob/sha/%2E%2E/%2E%2E/etc/%2E/passwd#L1');
    expect(u).not.toContain('/../');
  });
  it('ref: indexed sha as-is; a default branch with a slash is encoded per segment', () => {
    expect(blobUrl('acme/api', 'a1b2c3', 'x.ts', 1)).toContain('/blob/a1b2c3/x.ts');
    expect(blobUrl('acme/api', 'release/1.0', 'x.ts', 1)).toContain('/blob/release/1.0/x.ts');
    expect(blobUrl('acme/api', 'we ird#', 'x.ts', 1)).toContain('/blob/we%20ird%23/x.ts');
  });
  it('clamps an invalid line to 1', () => {
    expect(blobUrl('a/b', 's', 'x.ts', 0)).toMatch(/#L1$/);
    expect(blobUrl('a/b', 's', 'x.ts', NaN)).toMatch(/#L1$/);
  });
});
