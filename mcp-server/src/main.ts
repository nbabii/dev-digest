// Composition root: the only importer of api-client.ts. stdout belongs to the transport.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ApiClient } from './api-client.js';
import { RUN_WAIT_MS } from './constants.js';
import { resolveApiUrl } from './config.js';
import { buildMcpServer } from './server.js';

// Before anything else: stray console.log/info/debug must never reach stdout.
const toStderr = (...args: unknown[]): void => console.error(...args);
console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;

const log = (msg: string): void => {
  process.stderr.write(`[devdigest-mcp] ${msg}\n`);
};

function readWaitMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return RUN_WAIT_MS;
  const n = Number(raw);
  if (Number.isInteger(n) && n > 0) return n;
  log(`ignoring invalid DEVDIGEST_MCP_WAIT_MS=${JSON.stringify(raw)} (need a positive integer)`);
  return RUN_WAIT_MS;
}

async function main(): Promise<void> {
  let resolved;
  try {
    resolved = resolveApiUrl(process.env);
  } catch (e) {
    log(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  if (resolved.warnNonLoopback) {
    log(`warning: DEVDIGEST_API_URL points to a non-loopback host (${resolved.url})`);
  }

  const server = buildMcpServer({
    api: new ApiClient(resolved.url),
    baseUrl: resolved.url,
    waitMs: readWaitMs(process.env['DEVDIGEST_MCP_WAIT_MS']),
  });

  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    server.close().catch(() => undefined).finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.stdin.on('end', shutdown);
  process.stdin.on('close', shutdown);

  await server.connect(new StdioServerTransport());
  log(`ready, API ${resolved.url}`);
}

main().catch((e) => {
  log(`fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
