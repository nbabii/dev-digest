// Read use cases: findings of a finished run, conventions, agent list. No I/O beyond the port.
import { McpToolError } from '../errors.js';
import {
  projectAgent,
  shapeReview,
  truncate,
  type AgentView,
  type ResponseFormat,
  type SeverityLevel,
  type ShapedReview,
} from '../format.js';
import type { DevDigestApi, ReviewRecord } from '../ports.js';
import type { Resolver } from './resolve.js';

const MAX_CONVENTIONS = 50;

export interface ReviewQuery {
  severity?: SeverityLevel;
  limit?: number;
  cursor?: string;
  response_format?: ResponseFormat;
}

export interface GetFindingsInput extends ReviewQuery {
  repo: string;
  pr: number;
  run_id?: string;
  agent?: string;
}

/** Findings of one run via the reviews endpoint; shared with run-review. */
export async function collectReview(
  api: DevDigestApi,
  prId: string,
  runId: string,
  q: ReviewQuery,
): Promise<ShapedReview & { run_id: string }> {
  const reviews = await api.reviewsForPull(prId);
  const review: ReviewRecord | undefined = reviews.find((r) => r.run_id === runId);
  if (!review) {
    throw new McpToolError(
      `Run ${runId} has no stored review`,
      'check the run_id, or start a new review with run_agent_on_pr',
    );
  }
  const shaped = shapeReview(review, {
    ...(q.severity !== undefined && { severity: q.severity }),
    ...(q.limit !== undefined && { limit: q.limit }),
    ...(q.cursor !== undefined && { cursor: q.cursor }),
    ...(q.response_format !== undefined && { format: q.response_format }),
  });
  return { ...shaped, run_id: runId };
}

export interface ConventionsInput {
  repo: string;
  response_format?: ResponseFormat;
}

export type ConventionsResult =
  | { status: 'no_scan'; hint: string }
  | {
      status: 'ok';
      scan_status: string;
      total: number;
      conventions: Array<Record<string, unknown>>;
      truncated?: true;
      hint: string;
    };

export function createFindingsService(api: DevDigestApi, resolver: Resolver) {
  return {
    async getFindings(input: GetFindingsInput): Promise<ShapedReview & { run_id: string }> {
      const repo = await resolver.repo(input.repo);
      const prId = await resolver.pull(repo.id, input.pr);

      let runId = input.run_id;
      if (!runId) {
        const agentId = input.agent ? (await resolver.agent(input.agent)).id : undefined;
        const runs = (await api.listRuns(prId)).filter((r) => !agentId || r.agent_id === agentId);
        const done = runs.find((r) => r.status === 'done');
        if (!done) {
          const scope = agentId ? ' for that agent' : '';
          if (runs.length === 0) {
            throw new McpToolError(
              `No review runs exist for PR #${input.pr}${scope}`,
              'call run_agent_on_pr to start one',
            );
          }
          const active = runs.some((r) => r.status === 'running');
          throw new McpToolError(
            `No finished run for PR #${input.pr}${scope}: ${active ? 'a run is still in progress' : 'all runs failed or were cancelled'}`,
            active
              ? 'retry get_findings shortly'
              : 'call run_agent_on_pr to start a new review',
          );
        }
        runId = done.run_id;
      }
      return collectReview(api, prId, runId, input);
    },

    async getConventions(input: ConventionsInput): Promise<ConventionsResult> {
      const repo = await resolver.repo(input.repo);
      const { scan, candidates } = await api.conventions(repo.id);
      if (!scan) {
        return {
          status: 'no_scan',
          hint: 'no conventions scan exists for this repo; run one from the Conventions tab in the DevDigest UI, then call again',
        };
      }
      const active = candidates.filter((c) => c.status !== 'rejected');
      const shown = active.slice(0, MAX_CONVENTIONS);
      const detailed = input.response_format === 'detailed';
      const out: ConventionsResult = {
        status: 'ok',
        scan_status: scan.status,
        total: active.length,
        conventions: shown.map((c) => ({
          category: c.category,
          rule: truncate(c.rule, 500),
          at: `${c.evidence_path}:${c.evidence_line_start}-${c.evidence_line_end}`,
          ...(detailed && { id: c.id, confidence: c.confidence, status: c.status }),
        })),
        hint: `showing ${shown.length} of ${active.length}`,
      };
      if (active.length > shown.length) {
        out.truncated = true;
        out.hint = `showing ${shown.length} of ${active.length} conventions (cap ${MAX_CONVENTIONS}); review the rest in the Conventions tab`;
      }
      return out;
    },

    async listAgents(_input: { response_format?: ResponseFormat } = {}): Promise<{ agents: AgentView[] }> {
      return { agents: (await api.listAgents()).map(projectAgent) };
    },
  };
}

export type FindingsService = ReturnType<typeof createFindingsService>;
