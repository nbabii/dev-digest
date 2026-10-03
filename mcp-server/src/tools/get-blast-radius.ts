import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { blastSummaryLine } from '../format.js';
import { capResponse, ok, toToolError } from '../result.js';
import { DESCRIPTIONS } from './descriptions.js';
import type { ToolDeps } from './deps.js';
import { item, READ_ONLY, responseFormat } from './schemas.js';

export function registerGetBlastRadius(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'get_blast_radius',
    {
      title: 'Get PR blast radius',
      description: DESCRIPTIONS.get_blast_radius,
      inputSchema: {
        repo: z.string(),
        pr: z.number().int(),
        symbol: z.string().optional(),
        response_format: responseFormat,
      },
      outputSchema: {
        status: z.string(),
        repo: z.string().optional(),
        pr: z.number().optional(),
        index: item.optional(),
        changed_files: item.optional(),
        totals: item.optional(),
        limits: item.optional(),
        symbols: z.array(item).optional(),
        hint: z.string().optional(),
        truncated: z.boolean().optional(),
      },
      annotations: READ_ONLY,
    },
    async ({ repo, pr, symbol, response_format }) => {
      try {
        const res = await deps.blast.getBlastRadius({
          repo,
          pr,
          response_format,
          ...(symbol !== undefined && { symbol }),
        });
        const capped: Record<string, unknown> = capResponse({ ...res }, undefined, {
          narrowHint: 'narrow with symbol=<name>',
        });
        // capResponse replaces `hint` on truncation; keep the state hint too.
        const data = capped.truncated ? { ...capped, hint: `${capped.hint}; ${res.hint}` } : capped;
        return ok(blastSummaryLine(res), data);
      } catch (err) {
        return toToolError(err, deps.baseUrl);
      }
    },
  );
}
