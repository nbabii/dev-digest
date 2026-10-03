// Pure domain-shaped logic: no MCP SDK, no I/O. Invariants are plain TypeScript.
import { DEFAULT_LIMIT, MAX_LIMIT, MAX_RATIONALE_CHARS, MAX_SUGGESTION_CHARS, MAX_TITLE_CHARS } from './constants.js';
import { McpToolError } from './errors.js';
import type { Agent, BlastRadiusReport, BlastSymbolWire, FindingRecord, ReviewRecord } from './ports.js';

// ---- severity -------------------------------------------------------------

/** Tool-input levels, most severe first. The API has no `info` level. */
export const SEVERITY_LEVELS = ['critical', 'warning', 'suggestion'] as const;
export type SeverityLevel = (typeof SEVERITY_LEVELS)[number];

/** 0 = most severe. Unknown API values sort after every known level. */
export function severityRank(severity: string): number {
  const idx = SEVERITY_LEVELS.indexOf(severity.toLowerCase() as SeverityLevel);
  return idx === -1 ? SEVERITY_LEVELS.length : idx;
}

/** "This level and above": true when `severity` is at least as severe as `min`. */
export function meetsMinSeverity(severity: string, min: SeverityLevel | undefined): boolean {
  if (!min) return true;
  return severityRank(severity) <= severityRank(min);
}

// ---- filtering / sorting --------------------------------------------------

/** Dismissed findings are hidden; accepted ones stay. */
export function isActive(f: FindingRecord): boolean {
  return !f.dismissed_at;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Deterministic order: severity rank, file, start_line, id. */
export function sortFindings(findings: readonly FindingRecord[]): FindingRecord[] {
  return [...findings].sort(
    (a, b) =>
      severityRank(a.severity) - severityRank(b.severity) ||
      cmp(a.file, b.file) ||
      a.start_line - b.start_line ||
      cmp(a.id, b.id),
  );
}

export function selectFindings(findings: readonly FindingRecord[], min?: SeverityLevel): FindingRecord[] {
  return sortFindings(findings.filter((f) => isActive(f) && meetsMinSeverity(f.severity, min)));
}

// ---- shaping --------------------------------------------------------------

export type ResponseFormat = 'concise' | 'detailed';

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

export interface ConciseFinding {
  severity: string;
  title: string;
  at: string;
  category: string;
  suggestion?: string;
}

export interface DetailedFinding extends ConciseFinding {
  id: string;
  rationale: string;
  confidence: number;
  accepted: boolean;
}

export function conciseFinding(f: FindingRecord): ConciseFinding {
  const out: ConciseFinding = {
    severity: f.severity.toLowerCase(),
    title: truncate(f.title, MAX_TITLE_CHARS),
    at: `${f.file}:${f.start_line}-${f.end_line}`,
    category: f.category,
  };
  if (f.suggestion) out.suggestion = truncate(f.suggestion, MAX_SUGGESTION_CHARS);
  return out;
}

export function detailedFinding(f: FindingRecord): DetailedFinding {
  return {
    ...conciseFinding(f),
    id: f.id,
    rationale: truncate(f.rationale, MAX_RATIONALE_CHARS),
    confidence: f.confidence,
    accepted: !!f.accepted_at,
  };
}

// ---- cursor / pagination --------------------------------------------------

export function encodeCursor(offset: number): string {
  return Buffer.from(`o:${offset}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): number {
  const bad = () =>
    new McpToolError('Invalid cursor', 'omit cursor to start from the first page, or pass the next_cursor value from the previous response unchanged');
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw bad();
  const m = /^o:(\d{1,9})$/.exec(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (!m) throw bad();
  return Number(m[1]);
}

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

export interface Page<T> {
  items: T[];
  next_cursor?: string;
  total: number;
  truncated?: true;
  hint: string;
}

export function paginate<T>(
  all: readonly T[],
  opts: { limit?: number; cursor?: string; narrowHint?: string } = {},
): Page<T> {
  const limit = clampLimit(opts.limit);
  const start = opts.cursor ? decodeCursor(opts.cursor) : 0;
  const items = all.slice(start, start + limit);
  const end = start + items.length;
  const total = all.length;
  const page: Page<T> = { items, total, hint: '' };
  if (end < total) {
    page.next_cursor = encodeCursor(end);
    page.truncated = true;
    page.hint = `showing ${items.length} of ${total}, ${opts.narrowHint ?? 'narrow the filters'} or pass cursor`;
  } else {
    page.hint = `showing ${items.length} of ${total}`;
  }
  return page;
}

// ---- tokens ---------------------------------------------------------------

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

// ---- projections ----------------------------------------------------------

export interface ShapedReview {
  run_id?: string;
  verdict: string | null;
  score: number | null;
  summary?: string;
  findings: Array<ConciseFinding | DetailedFinding>;
  total: number;
  next_cursor?: string;
  truncated?: true;
  hint: string;
}

export interface ShapeReviewOptions {
  severity?: SeverityLevel;
  limit?: number;
  cursor?: string;
  format?: ResponseFormat;
}

export function shapeReview(review: ReviewRecord, opts: ShapeReviewOptions = {}): ShapedReview {
  const page = paginate(selectFindings(review.findings, opts.severity), {
    ...(opts.limit !== undefined && { limit: opts.limit }),
    ...(opts.cursor !== undefined && { cursor: opts.cursor }),
    narrowHint: 'narrow with severity=critical',
  });
  const shape = opts.format === 'detailed' ? detailedFinding : conciseFinding;
  const out: ShapedReview = {
    verdict: review.verdict ?? null,
    score: review.score ?? null,
    findings: page.items.map(shape),
    total: page.total,
    hint: page.hint,
  };
  if (review.run_id) out.run_id = review.run_id;
  if (review.summary) out.summary = truncate(review.summary, MAX_RATIONALE_CHARS);
  if (page.next_cursor) out.next_cursor = page.next_cursor;
  if (page.truncated) out.truncated = true;
  return out;
}

export interface AgentView {
  id: string;
  name: string;
  description: string;
  provider: string;
  model: string;
  enabled: boolean;
}

/** Explicit allowlist: system_prompt and any other API field never pass through. */
export function projectAgent(a: Agent): AgentView {
  return {
    id: a.id,
    name: a.name,
    description: truncate(a.description ?? '', MAX_TITLE_CHARS),
    provider: a.provider,
    model: a.model,
    enabled: a.enabled,
  };
}

// ---- blast radius ---------------------------------------------------------

export interface ShapedBlastSymbol {
  name: string;
  file: string;
  callers: Array<string | { name: string; file: string; line: number; url: string }>;
  callers_total: number;
  endpoints: string[];
  crons: string[];
  endpoints_total: number;
  crons_total: number;
  match?: 'file';
  kind?: string;
  line?: number | null;
  exported?: boolean;
}

export interface ShapedBlast {
  repo: string;
  pr: number;
  index: BlastRadiusReport['index'];
  changed_files: BlastRadiusReport['changed_files'];
  /** Passed through from the API, never recomputed from the (capped) arrays. */
  totals: BlastRadiusReport['totals'];
  limits: BlastRadiusReport['limits'];
  symbols: ShapedBlastSymbol[];
}

function shapeBlastSymbol(s: BlastSymbolWire, detailed: boolean): ShapedBlastSymbol {
  const out: ShapedBlastSymbol = {
    name: s.name,
    file: s.file,
    callers: detailed
      ? s.callers.map((c) => ({ name: c.name, file: c.file, line: c.line, url: c.url }))
      : s.callers.map((c) => `${c.file}:${c.line}`),
    callers_total: s.callers_total,
    endpoints: s.endpoints_affected,
    crons: s.crons_affected,
    endpoints_total: s.endpoints_total,
    crons_total: s.crons_total,
  };
  if (s.match === 'file') out.match = 'file';
  if (detailed) {
    out.kind = s.kind;
    out.line = s.line;
    out.exported = s.exported;
  }
  return out;
}

/** Every symbol and caller the API returned is kept; `symbol` narrows to one exact name (case-insensitive). */
export function shapeBlast(
  report: BlastRadiusReport,
  opts: { format?: ResponseFormat; symbol?: string } = {},
): ShapedBlast {
  const detailed = opts.format === 'detailed';
  const wanted = opts.symbol?.trim().toLowerCase();
  const symbols = report.symbols
    .filter((s) => !wanted || s.name.toLowerCase() === wanted)
    .map((s) => shapeBlastSymbol(s, detailed));
  return {
    repo: report.repo,
    pr: report.pr_number,
    index: report.index,
    changed_files: report.changed_files,
    totals: report.totals,
    limits: report.limits,
    symbols,
  };
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** One short line for `content`; numbers come from `totals`. */
export function blastSummaryLine(b: ShapedBlast): string {
  const idx = b.index.indexing ? `index ${b.index.status}, indexing` : `index ${b.index.status}`;
  if (!b.index.available) return `${b.repo}#${b.pr} · ${idx}`;
  const t = b.totals;
  return `${b.repo}#${b.pr} · ${plural(t.symbols, 'symbol')} · ${plural(t.callers, 'caller')} · ${plural(t.endpoints, 'endpoint')} · ${plural(t.crons, 'cron')} · ${idx}`;
}
