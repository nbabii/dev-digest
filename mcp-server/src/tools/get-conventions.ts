import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { capResponse, ok, toToolError } from '../result.js';
import { DESCRIPTIONS } from './descriptions.js';
import type { ToolDeps } from './deps.js';
import { item, READ_ONLY, responseFormat } from './schemas.js';

export function registerGetConventions(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'get_conventions',
    {
      title: 'Get repo conventions',
      description: DESCRIPTIONS.get_conventions,
      inputSchema: { repo: z.string(), response_format: responseFormat },
      outputSchema: {
        status: z.enum(['ok', 'no_scan']),
        scan_status: z.string().optional(),
        total: z.number().optional(),
        conventions: z.array(item).optional(),
        truncated: z.boolean().optional(),
        hint: z.string().optional(),
      },
      annotations: READ_ONLY,
    },
    async ({ repo, response_format }) => {
      try {
        const data = capResponse(await deps.findings.getConventions({ repo, response_format }));
        const line =
          data.status === 'ok' ? `${repo} · ${data.total} conventions` : `${repo} · no conventions scan yet`;
        return ok(line, data);
      } catch (err) {
        return toToolError(err, deps.baseUrl);
      }
    },
  );
}
