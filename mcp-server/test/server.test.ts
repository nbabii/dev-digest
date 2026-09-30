import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import type { DevDigestApi } from '../src/ports.js';
import { buildMcpServer } from '../src/server.js';
import { SERVER_INSTRUCTIONS, TOOL_NAMES } from '../src/tools/descriptions.js';

function throwingPort(): { api: DevDigestApi; calls: ReturnType<typeof vi.fn> } {
  const calls = vi.fn();
  const methods = ['listRepos', 'listPulls', 'listAgents', 'startReview', 'activeRuns', 'listRuns', 'reviewsForPull', 'conventions'];
  const api = Object.fromEntries(
    methods.map((m) => [m, (): never => { calls(m); throw new Error(`port touched: ${m}`); }]),
  ) as unknown as DevDigestApi;
  return { api, calls };
}

describe('buildMcpServer', () => {
  it('does no I/O at construction', () => {
    const { api, calls } = throwingPort();
    expect(() => buildMcpServer({ api, baseUrl: 'http://x' })).not.toThrow();
    expect(calls).not.toHaveBeenCalled();
  });

  it('registers the five tools and ships instructions', async () => {
    const { api, calls } = throwingPort();
    const server = buildMcpServer({ api, baseUrl: 'http://x' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 't', version: '0' });
    await Promise.all([server.connect(st), client.connect(ct)]);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    expect(calls).not.toHaveBeenCalled();
    await client.close();
  });
});
