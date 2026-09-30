import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ok, toToolError } from '../result.js';
import { DESCRIPTIONS } from './descriptions.js';
import type { ToolDeps } from './deps.js';
import { READ_ONLY, responseFormat } from './schemas.js';

export function registerGetBlastRadius(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'get_blast_radius',
    {
      title: 'Get PR blast radius',
      description: DESCRIPTIONS.get_blast_radius,
      inputSchema: { repo: z.string(), pr: z.number().int(), response_format: responseFormat },
      outputSchema: { status: z.literal('not_implemented') },
      annotations: READ_ONLY,
    },
    async ({ repo, pr }) => {
      try {
        return ok(`${repo}#${pr} · blast radius not implemented yet`, { status: 'not_implemented' });
      } catch (err) {
        return toToolError(err, deps.baseUrl);
      }
    },
  );
}
