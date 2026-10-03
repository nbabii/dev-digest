import { z } from 'zod';
import { MAX_ERROR_CHARS, REQUEST_TIMEOUT_MS } from './constants.js';
import {
  ApiError,
  type ActiveRun,
  type Agent,
  type BlastRadiusReport,
  type ConventionsResult,
  type DevDigestApi,
  type PrMeta,
  type Repo,
  type ReviewRecord,
  type RunSummary,
  type StartReviewResult,
} from './ports.js';

// Lenient guards: unknown fields are ignored, only fields we read are required,
// enums are open strings, and nullable wire fields are normalised to null.
const nullable = <T extends z.ZodTypeAny>(s: T) =>
  s.nullish().transform((v): z.infer<T> | null => v ?? null);

const repoG = z.object({
  id: z.string(),
  owner: z.string(),
  name: z.string(),
  full_name: z.string(),
});

const prG = z.object({
  id: z.string().nullish(),
  number: z.number(),
  title: z.string(),
  head_sha: z.string(),
  status: z.string(),
});

const agentG = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullish().transform((v) => v ?? ''),
  provider: z.string(),
  model: z.string(),
  enabled: z.boolean(),
});

const startReviewG = z.object({
  pr_id: z.string(),
  runs: z.array(z.object({ run_id: z.string(), agent_id: z.string(), agent_name: z.string() })),
});

const activeRunG = z.object({
  run_id: z.string(),
  agent_id: nullable(z.string()),
  agent_name: nullable(z.string()),
  ran_at: nullable(z.string()),
});

const runSummaryG = z.object({
  run_id: z.string(),
  agent_id: nullable(z.string()),
  agent_name: nullable(z.string()),
  status: nullable(z.string()),
  error: nullable(z.string()),
  findings_count: nullable(z.number()),
  score: nullable(z.number()),
  ran_at: nullable(z.string()),
});

const findingG = z.object({
  id: z.string(),
  severity: z.string(),
  category: z.string(),
  title: z.string(),
  file: z.string(),
  start_line: z.number(),
  end_line: z.number(),
  rationale: z.string().nullish().transform((v) => v ?? ''),
  suggestion: nullable(z.string()),
  confidence: z.number(),
  accepted_at: nullable(z.string()),
  dismissed_at: nullable(z.string()),
});

const reviewG = z.object({
  run_id: nullable(z.string()),
  agent_id: nullable(z.string()),
  agent_name: nullable(z.string()),
  verdict: nullable(z.string()),
  summary: nullable(z.string()),
  score: nullable(z.number()),
  created_at: z.string(),
  findings: z.array(findingG),
});

const conventionsG = z.object({
  scan: z
    .object({
      id: z.string(),
      status: z.string(),
      candidates_found: z.number(),
      error: nullable(z.string()),
      started_at: z.string(),
      finished_at: nullable(z.string()),
    })
    .nullish()
    .transform((v) => v ?? null),
  candidates: z.array(
    z.object({
      id: z.string(),
      category: z.string(),
      rule: z.string(),
      evidence_path: z.string(),
      evidence_line_start: z.number(),
      evidence_line_end: z.number(),
      confidence: z.number(),
      status: z.string(),
    }),
  ),
});

const int = z.number();
const strings = z.array(z.string()).nullish().transform((v) => v ?? []);

const blastG = z.object({
  repo: z.string(),
  pr_number: int,
  index: z.object({
    status: z.string(),
    indexing: z.boolean(),
    available: z.boolean(),
    reason: nullable(z.string()),
    facts_complete: z.boolean(),
    last_indexed_sha: nullable(z.string()),
  }),
  changed_files: z.object({
    total: int,
    covered: int,
    uncovered: strings,
    no_symbol_touched: strings,
    without_patch: int.nullish().transform((v) => v ?? 0),
    source: z.string(),
    truncated: z.boolean().nullish().transform((v) => v ?? false),
  }),
  totals: z.object({ symbols: int, callers: int, endpoints: int, crons: int }),
  symbols: z.array(
    z.object({
      name: z.string(),
      kind: z.string().nullish().transform((v) => v ?? ''),
      file: z.string(),
      line: nullable(int),
      exported: z.boolean().nullish().transform((v) => v ?? false),
      match: z.string().nullish().transform((v) => v ?? 'hunk'),
      callers: z.array(
        z.object({
          name: z.string(),
          file: z.string(),
          line: int,
          url: z.string().nullish().transform((v) => v ?? ''),
        }),
      ),
      callers_total: int,
      endpoints_total: int,
      crons_total: int,
      endpoints_affected: strings,
      crons_affected: strings,
    }),
  ),
  limits: z.object({
    symbols_truncated: z.boolean().nullish().transform((v) => v ?? false),
    callers_truncated: z.boolean().nullish().transform((v) => v ?? false),
  }),
});

const errorEnvelopeG = z.object({
  error: z.object({ code: z.string().optional(), message: z.string().optional() }),
});

type Guard<T> = z.ZodType<T, z.ZodTypeDef, unknown>;

const cap = (s: string): string => (s.length > MAX_ERROR_CHARS ? `${s.slice(0, MAX_ERROR_CHARS)}...` : s);
const enc = encodeURIComponent;

function parseRetryAfterMs(header: string | null): number | undefined {
  if (header === null) return undefined;
  const secs = Number(header.trim());
  if (!Number.isFinite(secs) || secs < 0 || header.trim() === '') return undefined;
  return Math.round(secs * 1000);
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

export class ApiClient implements DevDigestApi {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  listRepos(): Promise<Repo[]> {
    return this.request('GET', '/repos', z.array(repoG));
  }

  listPulls(repoId: string): Promise<PrMeta[]> {
    return this.request('GET', `/repos/${enc(repoId)}/pulls`, z.array(prG)) as Promise<PrMeta[]>;
  }

  listAgents(): Promise<Agent[]> {
    return this.request('GET', '/agents', z.array(agentG));
  }

  startReview(prId: string, agentId: string): Promise<StartReviewResult> {
    return this.request('POST', `/pulls/${enc(prId)}/review`, startReviewG, { agentId });
  }

  activeRuns(prId: string): Promise<ActiveRun[]> {
    return this.request('GET', `/pulls/${enc(prId)}/runs/active`, z.array(activeRunG));
  }

  listRuns(prId: string): Promise<RunSummary[]> {
    return this.request('GET', `/pulls/${enc(prId)}/runs`, z.array(runSummaryG));
  }

  reviewsForPull(prId: string): Promise<ReviewRecord[]> {
    return this.request('GET', `/pulls/${enc(prId)}/reviews`, z.array(reviewG));
  }

  conventions(repoId: string): Promise<ConventionsResult> {
    return this.request('GET', `/repos/${enc(repoId)}/conventions`, conventionsG);
  }

  blastRadius(prId: string): Promise<BlastRadiusReport> {
    return this.request('GET', `/pulls/${enc(prId)}/blast-radius`, blastG) as Promise<BlastRadiusReport>;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, guard: Guard<T>, body?: unknown): Promise<T> {
    const init: RequestInit = {
      method,
      headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    if (body !== undefined) init.body = JSON.stringify(body);

    let res: Response;
    let text: string;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, init);
      text = await res.text();
    } catch (err) {
      if (isTimeout(err)) {
        throw new ApiError('timeout', `DevDigest API did not answer within ${REQUEST_TIMEOUT_MS / 1000}s`);
      }
      throw new ApiError('unreachable', `DevDigest API not reachable at ${this.baseUrl}`);
    }

    if (res.status === 429) {
      const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'));
      throw new ApiError('rate_limited', 'DevDigest API rate limit hit', {
        status: 429,
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      });
    }

    const json = parseJson(text);

    if (!res.ok) {
      const env = errorEnvelopeG.safeParse(json);
      const code = env.success ? env.data.error.code : undefined;
      const message = env.success ? env.data.error.message : undefined;
      throw new ApiError('http', cap(message ?? `DevDigest API returned HTTP ${res.status}`), {
        status: res.status,
        ...(code !== undefined ? { code } : {}),
      });
    }

    if (json === undefined) {
      throw new ApiError('shape', 'DevDigest API returned a non-JSON response', { status: res.status });
    }
    const parsed = guard.safeParse(json);
    if (!parsed.success) {
      throw new ApiError('shape', `DevDigest API response for ${method} ${path.split('?')[0]} did not match the expected shape`, {
        status: res.status,
      });
    }
    return parsed.data;
  }
}

function parseJson(text: string): unknown {
  if (text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
