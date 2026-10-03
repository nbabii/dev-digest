/**
 * blast helpers — PURE (no I/O). Everything the service needs to turn a PR's
 * patches + the repo-intel read model into a deterministic report: index state
 * derivation, hunk -> symbol intersection, grouping/caps/sorting, formatting.
 */
import type {
  BlastCallerLink,
  BlastIndex,
  BlastSymbolImpact,
} from '@devdigest/shared';
import type { BlastCallerRow, IndexState, SymbolRow } from '../repo-intel/types.js';
import {
  MAX_CALLERS_PER_SYMBOL,
  MAX_CRONS_PER_SYMBOL,
  MAX_ENDPOINTS_PER_SYMBOL,
  MAX_SYMBOLS,
} from './constants.js';

// ---------------------------------------------------------------------------
// Index state
// ---------------------------------------------------------------------------

/** Stop reasons after which `file_facts` / `file_edges` are known incomplete. */
const FACTS_INCOMPLETE_REASONS = new Set(['soft_budget', 'graph_failed']);

/**
 * The facade synthesises a `degraded/no_data` row (empty sha) when there is no
 * `repo_index_state` row at all; that is "not indexed", not "degraded".
 */
function isSynthesisedNoRow(state: IndexState): boolean {
  return state.lastIndexedSha === '' && state.degradedReason === 'no_data';
}

export function deriveIndex(input: {
  flagEnabled: boolean;
  state: IndexState | null;
}): BlastIndex {
  const { flagEnabled, state } = input;
  const none = {
    indexing: false,
    available: false,
    reason: null,
    facts_complete: false,
    last_indexed_sha: null,
    indexed_at: null,
  };
  if (!flagEnabled) return { ...none, status: 'disabled' };
  if (!state || isSynthesisedNoRow(state)) return { ...none, status: 'not_indexed' };

  const status =
    state.status === 'full' ? 'ready' : state.status === 'partial' ? 'partial' : 'degraded';
  const reason = state.reason ?? state.degradedReason ?? null;
  const available = status === 'ready' || status === 'partial';
  return {
    status,
    indexing: state.indexing === true,
    available,
    reason,
    facts_complete:
      status === 'ready' || (status === 'partial' && !FACTS_INCOMPLETE_REASONS.has(reason ?? '')),
    last_indexed_sha: state.lastIndexedSha || null,
    indexed_at: state.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Patches -> touched base-side lines
// ---------------------------------------------------------------------------

export interface TouchedLines {
  /** Old-side (base) line numbers removed/modified by the patch. */
  lines: Set<number>;
  /**
   * Insertion boundaries: `k` = last old line before a run of `+` lines
   * (0 = before the first line).
   */
  insertions: number[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/;

/**
 * Walk a per-file patch with an OLD-side cursor. The index is a snapshot of
 * the default branch (the PR's base side), so only old-side numbers are
 * meaningful. Hunk line counts in the header are deliberately not enforced
 * (hand-written / truncated patches are common); lines are classified by their
 * first character until the next `@@`.
 */
export function touchedBaseLines(patch: string): TouchedLines {
  const lines = new Set<number>();
  const insertions: number[] = [];
  let cursor = 0;
  let inHunk = false;
  let inPlusRun = false;

  for (const line of patch.split('\n')) {
    const h = HUNK_RE.exec(line);
    if (h) {
      const oldStart = Number(h[1]);
      const oldLines = h[2] === undefined ? 1 : Number(h[2]);
      // `-N,0` means "insert after line N"; otherwise N is the first old line.
      cursor = oldLines === 0 ? oldStart + 1 : oldStart;
      inHunk = true;
      inPlusRun = false;
      continue;
    }
    if (!inHunk) continue;
    const c = line[0];
    if (c === '\\') continue; // "\ No newline at end of file"
    if (c === '+') {
      if (!inPlusRun) insertions.push(cursor - 1);
      inPlusRun = true;
    } else if (c === '-') {
      lines.add(cursor);
      cursor++;
      inPlusRun = false;
    } else {
      // context line (' ') or an empty trailing line
      cursor++;
      inPlusRun = false;
    }
  }
  return { lines, insertions };
}

/**
 * Per-file patch text out of a raw multi-file `git diff` (tier b). Done here so
 * the git adapter / `parseUnifiedDiff` need no change: `DiffHunk` keeps only
 * new-side numbers. Keyed by the OLD (`a/`) path, which is what the index holds.
 * Files with no `@@` hunk (binary, mode-only) get `patch: null`.
 */
export function splitRawDiff(raw: string): { path: string; patch: string | null }[] {
  const out: { path: string; patch: string | null }[] = [];
  const chunks = raw.split(/^diff --git /m).slice(1);
  for (const chunk of chunks) {
    const nl = chunk.indexOf('\n');
    const header = nl === -1 ? chunk : chunk.slice(0, nl);
    const m = /^a\/(.*?) b\/(.*)$/.exec(header);
    if (!m) continue;
    const at = chunk.search(/^@@ /m);
    out.push({ path: m[1]!, patch: at === -1 ? null : chunk.slice(at) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Symbol selection
// ---------------------------------------------------------------------------

const CALLABLE_KINDS = new Set(['function', 'method']);

/**
 * Candidate symbols = index rows minus dotted `Class.method` duplicates, one
 * per `(file, name)` (prefer a callable kind, then the lowest line).
 */
export function dedupeCandidates(rows: SymbolRow[]): SymbolRow[] {
  const best = new Map<string, SymbolRow>();
  for (const r of rows) {
    if (r.name.includes('.')) continue;
    const key = `${r.file}\u0000${r.name}`;
    const cur = best.get(key);
    if (!cur) {
      best.set(key, r);
      continue;
    }
    const rc = CALLABLE_KINDS.has(r.kind);
    const cc = CALLABLE_KINDS.has(cur.kind);
    if ((rc && !cc) || (rc === cc && r.startLine < cur.startLine)) best.set(key, r);
  }
  return [...best.values()];
}

export interface TouchedSymbol {
  symbol: SymbolRow;
  match: 'hunk' | 'file';
}

export interface SelectionResult {
  touched: TouchedSymbol[];
  /** Covered files whose diff touches no declared symbol. */
  noSymbolTouched: string[];
  /** Covered files that used the `match:'file'` fallback. */
  withoutPatch: string[];
}

function hasUsableRange(s: SymbolRow): boolean {
  return s.rangeKnown !== false && s.startLine > 0 && s.endLine >= s.startLine;
}

function intersects(s: SymbolRow, t: TouchedLines): boolean {
  for (const l of t.lines) if (l >= s.startLine && l <= s.endLine) return true;
  // Insertion strictly inside the body; lines appended right after `end` do not count.
  for (const k of t.insertions) if (k >= s.startLine && k < s.endLine) return true;
  return false;
}

/**
 * Pick the candidates the diff actually touches. `touchedByFile.get(file)` is
 * `null`/absent when the file has no patch text. Per-file fallback
 * (`match:'file'`): no patch, or no candidate in the file has a usable range.
 */
export function selectTouchedSymbols(
  candidates: SymbolRow[],
  touchedByFile: Map<string, TouchedLines | null>,
): SelectionResult {
  const byFile = new Map<string, SymbolRow[]>();
  for (const c of candidates) {
    const arr = byFile.get(c.file);
    if (arr) arr.push(c);
    else byFile.set(c.file, [c]);
  }

  const touched: TouchedSymbol[] = [];
  const noSymbolTouched: string[] = [];
  const withoutPatch: string[] = [];
  for (const [file, syms] of byFile) {
    const info = touchedByFile.get(file) ?? null;
    if (!info || !syms.some(hasUsableRange)) {
      withoutPatch.push(file);
      for (const symbol of syms) touched.push({ symbol, match: 'file' });
      continue;
    }
    const hit = syms.filter((s) => hasUsableRange(s) && intersects(s, info));
    if (hit.length === 0) noSymbolTouched.push(file);
    for (const symbol of hit) touched.push({ symbol, match: 'hunk' });
  }
  return { touched, noSymbolTouched, withoutPatch };
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export interface GroupInput {
  touched: TouchedSymbol[];
  callers: BlastCallerRow[];
  factsByFile: Record<string, { endpoints: string[]; crons: string[] }>;
  /** `owner/name`, ref (indexed sha or default branch) for caller links. */
  fullName: string;
  ref: string;
  /** Facade hit its SQL caller-row cap. */
  rowCapHit?: boolean;
}

export interface GroupResult {
  symbols: BlastSymbolImpact[];
  totals: { symbols: number; callers: number; endpoints: number; crons: number };
  limits: { symbols_truncated: boolean; callers_truncated: boolean };
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Group caller rows under the touched symbols they reach (by `declFile` +
 * name, so two changed files declaring `init` stay separate), union the
 * endpoint/cron facts of every caller file, apply the caps and sort
 * deterministically. `totals` and `*_total` are DISTINCT counts taken BEFORE
 * any cap; consumers must display those, never re-sum the capped arrays.
 */
export function groupBlast(input: GroupInput): GroupResult {
  const { touched, callers, factsByFile, fullName, ref } = input;

  const callersBySym = new Map<string, BlastCallerRow[]>();
  for (const c of callers) {
    if (c.declFile === undefined) continue;
    const key = `${c.declFile}\u0000${c.viaSymbol}`;
    const arr = callersBySym.get(key);
    if (arr) arr.push(c);
    else callersBySym.set(key, [c]);
  }

  // One entry per (file, name); a duplicate keeps the stronger match.
  const unique = new Map<string, TouchedSymbol>();
  for (const t of touched) {
    const key = `${t.symbol.file}\u0000${t.symbol.name}`;
    const cur = unique.get(key);
    if (!cur || (cur.match === 'file' && t.match === 'hunk')) unique.set(key, t);
  }

  const allCallers = new Set<string>();
  const allEndpoints = new Set<string>();
  const allCrons = new Set<string>();
  let anyCallersCapped = false;

  const impacts: BlastSymbolImpact[] = [];
  for (const { symbol, match } of unique.values()) {
    const rows = [...(callersBySym.get(`${symbol.file}\u0000${symbol.name}`) ?? [])].sort(
      (a, b) => b.rank - a.rank || cmp(a.file, b.file) || a.line - b.line,
    );
    const seen = new Set<string>();
    const dedup: BlastCallerRow[] = [];
    for (const r of rows) {
      const k = `${r.file}\u0000${r.symbol}`;
      if (seen.has(k)) continue;
      seen.add(k);
      dedup.push(r);
      allCallers.add(k);
    }

    const callerFiles = [...new Set(dedup.map((r) => r.file))];
    const endpoints = new Set<string>();
    const crons = new Set<string>();
    for (const f of callerFiles) {
      const facts = factsByFile[f];
      if (!facts) continue;
      for (const e of facts.endpoints) endpoints.add(e);
      for (const c of facts.crons) crons.add(formatCron(c, f));
    }
    for (const e of endpoints) allEndpoints.add(e);
    for (const c of crons) allCrons.add(c);

    if (dedup.length > MAX_CALLERS_PER_SYMBOL) anyCallersCapped = true;
    const links: BlastCallerLink[] = dedup.slice(0, MAX_CALLERS_PER_SYMBOL).map((r) => ({
      name: r.symbol,
      file: r.file,
      line: r.line,
      url: blobUrl(fullName, ref, r.file, r.line),
    }));
    const endpointList = [...endpoints].sort(cmp);
    const cronList = [...crons].sort(cmp);

    impacts.push({
      symbol: symbol.name,
      callers: links,
      endpoints_affected: endpointList.slice(0, MAX_ENDPOINTS_PER_SYMBOL),
      crons_affected: cronList.slice(0, MAX_CRONS_PER_SYMBOL),
      file: symbol.file,
      kind: symbol.kind,
      line: symbol.startLine > 0 ? symbol.startLine : null,
      exported: symbol.exported,
      match,
      callers_total: dedup.length,
      endpoints_total: endpointList.length,
      crons_total: cronList.length,
    });
  }

  impacts.sort(
    (a, b) =>
      (a.match === b.match ? 0 : a.match === 'hunk' ? -1 : 1) ||
      b.callers_total - a.callers_total ||
      (a.exported === b.exported ? 0 : a.exported ? -1 : 1) ||
      cmp(a.file, b.file) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      cmp(a.symbol, b.symbol),
  );

  return {
    symbols: impacts.slice(0, MAX_SYMBOLS),
    totals: {
      symbols: impacts.length,
      callers: allCallers.size,
      endpoints: allEndpoints.size,
      crons: allCrons.size,
    },
    limits: {
      symbols_truncated: impacts.length > MAX_SYMBOLS,
      callers_truncated: anyCallersCapped || input.rowCapHit === true,
    },
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Cron chip label. `job:<kind>` -> `<kind>`; an expression -> `<file> (<humanised>)`. */
export function formatCron(raw: string, filePath: string): string {
  if (raw.startsWith('job:')) return raw.slice(4);
  const base = (filePath.split('/').pop() ?? filePath).replace(/\.[^.]+$/, '');
  return `${base} (${humanizeCron(raw)})`;
}

const NUM = /^\d+$/;
const STEP = /^\*\/(\d+)$/;

/** Best-effort 5-field cron description; falls back to the raw expression. */
export function humanizeCron(expr: string): string {
  const raw = expr.trim();
  const f = raw.split(/\s+/);
  if (f.length !== 5) return raw;
  const [min, hour, dom, mon, dow] = f as [string, string, string, string, string];
  if (mon !== '*') return raw;

  if (hour === '*' && dom === '*' && dow === '*') {
    if (min === '*') return 'every min';
    const step = STEP.exec(min);
    if (step) return `every ${Number(step[1])} min`;
    if (NUM.test(min)) return 'hourly';
    return raw;
  }
  if (NUM.test(min) && dom === '*' && dow === '*') {
    const step = STEP.exec(hour);
    if (step) return `every ${Number(step[1])} h`;
    if (NUM.test(hour)) return 'daily';
    return raw;
  }
  if (NUM.test(min) && NUM.test(hour)) {
    if (dom === '*' && dow !== '*') return 'weekly';
    if (dom !== '*' && dow === '*') return 'monthly';
  }
  return raw;
}

/** Encode one path segment; `.`/`..` survive encodeURIComponent, so force them. */
function seg(s: string): string {
  if (s === '..') return '%2E%2E';
  if (s === '.') return '%2E';
  return encodeURIComponent(s);
}

/**
 * GitHub blob link, built once on the server from DB values. Segments are
 * encoded individually (file names are attacker-influenced); `ref` is the
 * indexed sha (line numbers come from that snapshot) or the default branch.
 */
export function blobUrl(fullName: string, ref: string, path: string, line: number): string {
  const repo = fullName.split('/').map(seg).join('/');
  const r = ref.split('/').map(seg).join('/');
  const p = path.split('/').map(seg).join('/');
  const l = Number.isFinite(line) && line >= 1 ? Math.floor(line) : 1;
  return `https://github.com/${repo}/blob/${r}/${p}#L${l}`;
}
