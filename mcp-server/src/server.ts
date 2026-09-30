// Delivery composition: builds the McpServer from an injected port. No I/O at construction.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { POLL_MS, RUN_WAIT_MS } from './constants.js';
import type { DevDigestApi } from './ports.js';
import { createFindingsService } from './services/findings.js';
import { createResolver } from './services/resolve.js';
import { createRunReviewService } from './services/run-review.js';
import { registerGetBlastRadius } from './tools/get-blast-radius.js';
import { registerGetConventions } from './tools/get-conventions.js';
import { registerGetFindings } from './tools/get-findings.js';
import { registerListAgents } from './tools/list-agents.js';
import { registerRunAgentOnPr } from './tools/run-agent-on-pr.js';
import { SERVER_INSTRUCTIONS } from './tools/descriptions.js';
import type { ToolDeps } from './tools/deps.js';

export const SERVER_NAME = 'devdigest';
export const SERVER_VERSION = '0.0.0';

export interface BuildMcpServerOptions {
  api: DevDigestApi;
  baseUrl: string;
  waitMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export function buildMcpServer(opts: BuildMcpServerOptions): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  const resolver = createResolver(opts.api, opts.now ? { now: opts.now } : {});
  const findings = createFindingsService(opts.api, resolver);
  const runReview = createRunReviewService(opts.api, resolver, {
    waitMs: opts.waitMs ?? RUN_WAIT_MS,
    pollMs: opts.pollMs ?? POLL_MS,
    ...(opts.sleep && { sleep: opts.sleep }),
    ...(opts.now && { now: opts.now }),
  });

  const deps: ToolDeps = { findings, runReview, baseUrl: opts.baseUrl };
  registerListAgents(server, deps);
  registerRunAgentOnPr(server, deps);
  registerGetFindings(server, deps);
  registerGetConventions(server, deps);
  registerGetBlastRadius(server, deps);

  return server;
}
