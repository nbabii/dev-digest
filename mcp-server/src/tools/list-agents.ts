import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { capResponse, ok, toToolError } from '../result.js';
import { DESCRIPTIONS } from './descriptions.js';
import type { ToolDeps } from './deps.js';
import { item, READ_ONLY, responseFormat } from './schemas.js';

export function registerListAgents(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'list_agents',
    {
      title: 'List review agents',
      description: DESCRIPTIONS.list_agents,
      inputSchema: { response_format: responseFormat },
      outputSchema: { agents: z.array(item) },
      annotations: READ_ONLY,
    },
    async ({ response_format }) => {
      try {
        const data = capResponse(await deps.findings.listAgents({ response_format }));
        return ok(`${data.agents.length} agents`, data);
      } catch (err) {
        return toToolError(err, deps.baseUrl);
      }
    },
  );
}
