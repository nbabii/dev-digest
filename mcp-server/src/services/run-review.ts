// run_agent_on_pr use case: resolve -> dedupe -> start -> poll -> collect.
import { MAX_ERROR_CHARS } from '../constants.js';
import { McpToolError } from '../errors.js';
import { truncate, type ShapedReview } from '../format.js';
import { ApiError, type DevDigestApi, type RunSummary } from '../ports.js';
import { collectReview, type ReviewQuery } from './findings.js';
import type { Resolver } from './resolve.js';

const DEFAULT_BACKOFF_MS = 5_000;
const MAX_RATE_LIMIT_HITS = 3;

export interface RunAgentInput extends ReviewQuery {
  repo: string;
  pr: number;
  agent: string;
}

export type RunReviewResult =
  | ({ status: 'done'; run_id: string } & ShapedReview)
  | { status: 'running'; run_id: string; hint: string }
  | { status: 'failed' | 'cancelled'; run_id: string; error: string };

interface Settled {
  run_id: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  error?: string;
}

export interface RunReviewOptions {
  waitMs: number;
  pollMs: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function cleanError(raw: string | null | undefined): string {
  const first = (raw ?? '').split(/\n\s+at\s/)[0]?.trim() ?? '';
  return truncate(first || 'run ended without an error message', MAX_ERROR_CHARS);
}

export function createRunReviewService(api: DevDigestApi, resolver: Resolver, opts: RunReviewOptions) {
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const inFlight = new Map<string, Promise<Settled>>();

  async function wait(prId: string, runId: string): Promise<Settled> {
    const started = now();
    let hits = 0;
    for (;;) {
      let run: RunSummary | undefined;
      try {
        run = (await api.listRuns(prId)).find((r) => r.run_id === runId);
        hits = 0;
      } catch (e) {
        if (!(e instanceof ApiError) || e.kind !== 'rate_limited') throw e;
        if (++hits >= MAX_RATE_LIMIT_HITS) return { run_id: runId, status: 'running' };
        await sleep(e.retryAfterMs ?? DEFAULT_BACKOFF_MS);
        if (now() - started >= opts.waitMs) return { run_id: runId, status: 'running' };
        continue;
      }
      const s = run?.status;
      if (s === 'done') return { run_id: runId, status: 'done' };
      if (s === 'failed') return { run_id: runId, status: 'failed', error: cleanError(run?.error) };
      if (s === 'cancelled') return { run_id: runId, status: 'cancelled', error: cleanError(run?.error) };
      if (now() - started >= opts.waitMs) return { run_id: runId, status: 'running' };
      await sleep(opts.pollMs);
    }
  }

  async function acquire(prId: string, agentId: string): Promise<Settled> {
    const active = (await api.activeRuns(prId)).find((r) => r.agent_id === agentId);
    let runId = active?.run_id;
    if (!runId) {
      const started = await api.startReview(prId, agentId);
      runId = started.runs[0]?.run_id;
      if (!runId) {
        throw new McpToolError('The API started no run', 'call list_agents to check the agent is enabled, then retry');
      }
    }
    return wait(prId, runId);
  }

  return {
    async runAgentOnPr(input: RunAgentInput): Promise<RunReviewResult> {
      const repo = await resolver.repo(input.repo);
      const prId = await resolver.pull(repo.id, input.pr);
      const agent = await resolver.agent(input.agent);

      const key = `${prId}:${agent.id}`;
      let flight = inFlight.get(key);
      if (!flight) {
        flight = acquire(prId, agent.id).finally(() => inFlight.delete(key));
        inFlight.set(key, flight);
      }
      const settled = await flight;

      if (settled.status === 'running') {
        return {
          status: 'running',
          run_id: settled.run_id,
          hint: 'still running; read it later with get_findings(run_id)',
        };
      }
      if (settled.status === 'done') {
        const review = await collectReview(api, prId, settled.run_id, input);
        return { ...review, status: 'done' };
      }
      return { status: settled.status, run_id: settled.run_id, error: settled.error ?? cleanError(null) };
    },
  };
}

export type RunReviewService = ReturnType<typeof createRunReviewService>;
