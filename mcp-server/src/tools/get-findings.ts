import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { capResponse, ok, toToolError } from '../result.js';
import { DESCRIPTIONS } from './descriptions.js';
import type { ToolDeps } from './deps.js';
import { limit, READ_ONLY, responseFormat, reviewOutput, severity } from './schemas.js';

export function registerGetFindings(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'get_findings',
    {
      title: 'Get review findings',
      description: DESCRIPTIONS.get_findings,
      inputSchema: {
        repo: z.string(),
        pr: z.number().int(),
        run_id: z.string().optional(),
        agent: z.string().optional(),
        severity: severity.optional(),
        limit,
        cursor: z.string().optional(),
        response_format: responseFormat,
      },
      outputSchema: reviewOutput,
      annotations: READ_ONLY,
    },
    async ({ repo, pr, run_id, agent, severity, limit, cursor, response_format }) => {
      try {
        const res = await deps.findings.getFindings({
          repo,
          pr,
          limit,
          response_format,
          ...(run_id !== undefined && { run_id }),
          ...(agent !== undefined && { agent }),
          ...(severity !== undefined && { severity }),
          ...(cursor !== undefined && { cursor }),
        });
        const data = capResponse({ ...res });
        return ok(`${repo}#${pr} · ${data.verdict ?? 'no verdict'} · ${data.total} findings`, data);
      } catch (err) {
        return toToolError(err, deps.baseUrl);
      }
    },
  );
}
