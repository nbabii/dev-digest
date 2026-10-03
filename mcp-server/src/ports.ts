// Port + local wire types. Only fields the MCP server reads; the API may add more.

/** Open string union: known values keep editor hints, unknown ones still typecheck. */
type Open<T extends string> = T | (string & {});

export type ApiErrorKind = 'unreachable' | 'timeout' | 'rate_limited' | 'http' | 'shape';

export interface ApiErrorInit {
  status?: number;
  code?: string;
  retryAfterMs?: number;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly code?: string;
  readonly retryAfterMs?: number;

  constructor(kind: ApiErrorKind, message: string, init: ApiErrorInit = {}) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    if (init.status !== undefined) this.status = init.status;
    if (init.code !== undefined) this.code = init.code;
    if (init.retryAfterMs !== undefined) this.retryAfterMs = init.retryAfterMs;
  }
}

export interface Repo {
  id: string;
  owner: string;
  name: string;
  full_name: string;
}

export type PrStatus = Open<'needs_review' | 'reviewed' | 'stale' | 'open' | 'closed' | 'merged'>;

export interface PrMeta {
  id?: string | null;
  number: number;
  title: string;
  head_sha: string;
  status: PrStatus;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  provider: Open<'openai' | 'anthropic' | 'openrouter'>;
  model: string;
  enabled: boolean;
}

export interface ReviewRunTarget {
  run_id: string;
  agent_id: string;
  agent_name: string;
}

export interface StartReviewResult {
  pr_id: string;
  runs: ReviewRunTarget[];
}

export interface ActiveRun {
  run_id: string;
  agent_id: string | null;
  agent_name: string | null;
  ran_at: string | null;
}

export type RunStatus = Open<'running' | 'done' | 'failed' | 'cancelled'>;

export interface RunSummary {
  run_id: string;
  agent_id: string | null;
  agent_name: string | null;
  status: RunStatus | null;
  error: string | null;
  findings_count: number | null;
  score: number | null;
  ran_at: string | null;
}

/** API enum is uppercase (CRITICAL | WARNING | SUGGESTION). */
export type FindingSeverity = Open<'CRITICAL' | 'WARNING' | 'SUGGESTION'>;
export type FindingCategory = Open<'bug' | 'security' | 'perf' | 'style' | 'test'>;
export type Verdict = Open<'request_changes' | 'approve' | 'comment'>;

export interface FindingRecord {
  id: string;
  severity: FindingSeverity;
  category: FindingCategory;
  title: string;
  file: string;
  start_line: number;
  end_line: number;
  rationale: string;
  suggestion?: string | null;
  confidence: number;
  accepted_at: string | null;
  dismissed_at: string | null;
}

export interface ReviewRecord {
  run_id: string | null;
  agent_id: string | null;
  agent_name?: string | null;
  verdict: Verdict | null;
  summary: string | null;
  score: number | null;
  created_at: string;
  findings: FindingRecord[];
}

export type ConventionStatus = Open<'pending' | 'accepted' | 'rejected'>;

export interface ConventionScan {
  id: string;
  status: Open<'running' | 'completed' | 'failed'>;
  candidates_found: number;
  error?: string | null;
  started_at: string;
  finished_at?: string | null;
}

export interface ConventionCandidate {
  id: string;
  category: string;
  rule: string;
  evidence_path: string;
  evidence_line_start: number;
  evidence_line_end: number;
  confidence: number;
  status: ConventionStatus;
}

export interface ConventionsResult {
  scan: ConventionScan | null;
  candidates: ConventionCandidate[];
}

/** Blast-radius wire type: only fields the MCP server reads (GET /pulls/:id/blast-radius). */
export interface BlastCallerWire {
  name: string;
  file: string;
  line: number;
  url: string;
}

export interface BlastSymbolWire {
  name: string;
  kind: string;
  file: string;
  line: number | null;
  exported: boolean;
  /** 'file' = per-file fallback (no usable patch/range). */
  match: Open<'hunk' | 'file'>;
  callers: BlastCallerWire[];
  callers_total: number;
  endpoints_total: number;
  crons_total: number;
  endpoints_affected: string[];
  crons_affected: string[];
}

export interface BlastRadiusReport {
  repo: string;
  pr_number: number;
  index: {
    status: Open<'ready' | 'partial' | 'degraded' | 'not_indexed' | 'disabled'>;
    indexing: boolean;
    available: boolean;
    reason: string | null;
    facts_complete: boolean;
    last_indexed_sha: string | null;
  };
  changed_files: {
    total: number;
    covered: number;
    uncovered: string[];
    no_symbol_touched: string[];
    without_patch: number;
    source: Open<'pr_files' | 'git' | 'github' | 'none'>;
    truncated: boolean;
  };
  totals: { symbols: number; callers: number; endpoints: number; crons: number };
  symbols: BlastSymbolWire[];
  limits: { symbols_truncated: boolean; callers_truncated: boolean };
}

export interface DevDigestApi {
  listRepos(): Promise<Repo[]>;
  listPulls(repoId: string): Promise<PrMeta[]>;
  listAgents(): Promise<Agent[]>;
  startReview(prId: string, agentId: string): Promise<StartReviewResult>;
  activeRuns(prId: string): Promise<ActiveRun[]>;
  listRuns(prId: string): Promise<RunSummary[]>;
  reviewsForPull(prId: string): Promise<ReviewRecord[]>;
  conventions(repoId: string): Promise<ConventionsResult>;
  blastRadius(prId: string): Promise<BlastRadiusReport>;
}
