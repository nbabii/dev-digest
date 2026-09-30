import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { capResponse, ok, toToolError } from '../result.js';
import { DESCRIPTIONS } from './descriptions.js';
import type { ToolDeps } from './deps.js';
import { limit, responseFormat, reviewOutput, RUNS_REVIEW, severity } from './schemas.js';

export function registerRunAgentOnPr(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'run_agent_on_pr',
    {
      title: 'Run review agent on a PR',
      description: DESCRIPTIONS.run_agent_on_pr,
      inputSchema: {
        repo: z.string(),
        pr: z.number().int(),
        agent: z.string(),
        response_format: responseFormat,
        severity: severity.optional(),
        limit,
      },
      outputSchema: {
        status: z.enum(['done', 'running', 'failed', 'cancelled']),
        error: z.string().optional(),
        ...reviewOutput,
      },
      annotations: RUNS_REVIEW,
    },
    async ({ repo, pr, agent, response_format, severity, limit }) => {
      try {
        const res = await deps.runReview.runAgentOnPr({
          repo,
          pr,
          agent,
          response_format,
          limit,
          ...(severity !== undefined && { severity }),
        });
        const data = capResponse({ ...res });
        const ref = `${repo}#${pr} · ${agent}`;
        let line: string;
        if (data.status === 'done') {
          line = `${ref} · ${data.verdict ?? 'no verdict'} · ${data.total} findings`;
        } else if (data.status === 'running') {
          line = `${ref} · still running · run_id ${data.run_id}`;
        } else {
          line = `${ref} · ${data.status} · run_id ${data.run_id}`;
        }
        return ok(line, data);
      } catch (err) {
        return toToolError(err, deps.baseUrl);
      }
    },
  );
}
