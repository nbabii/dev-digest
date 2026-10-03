import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { getEncoding } from 'js-tiktoken';
import { describe, expect, it, vi } from 'vitest';
import type { DevDigestApi } from '../src/ports.js';
import { buildMcpServer } from '../src/server.js';
import { TOOL_NAMES } from '../src/tools/descriptions.js';

const enc = getEncoding('cl100k_base');
const count = (v: unknown): number => enc.encode(typeof v === 'string' ? v : JSON.stringify(v)).length;

const FLAT = new Set(['string', 'integer', 'number', 'boolean']);

function isFlat(prop: Record<string, unknown>): boolean {
  if (prop['enum']) return true;
  const t = prop['type'];
  return typeof t === 'string' && FLAT.has(t);
}

describe('startup token budget', () => {
  it('stays within budget with zero port calls', async () => {
    const calls = vi.fn();
    const methods = ['listRepos', 'listPulls', 'listAgents', 'startReview', 'activeRuns', 'listRuns', 'reviewsForPull', 'conventions', 'blastRadius'];
    const api = Object.fromEntries(
      methods.map((m) => [m, (): never => { calls(m); throw new Error(`port touched: ${m}`); }]),
    ) as unknown as DevDigestApi;

    const server = buildMcpServer({ api, baseUrl: 'http://x' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'budget', version: '0' });
    await Promise.all([server.connect(st), client.connect(ct)]);

    const listed = await client.listTools();
    const instructions = client.getInstructions() ?? '';
    const total = count(listed.tools);
    const perTool = Object.fromEntries(listed.tools.map((t) => [t.name, count(t)]));
    const instr = count(instructions);
    console.info(`[budget] tools/list=${total} perTool=${JSON.stringify(perTool)} instructions=${instr}`);

    expect(total).toBeLessThanOrEqual(3000);
    for (const [name, n] of Object.entries(perTool)) expect(n, name).toBeLessThanOrEqual(700);
    expect(instr).toBeLessThanOrEqual(100);
    expect(listed.tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());

    for (const t of listed.tools) {
      const a = t.annotations ?? {};
      expect(a.readOnlyHint, `${t.name} readOnlyHint`).toBeTypeOf('boolean');
      expect(a.destructiveHint, `${t.name} destructiveHint`).toBeTypeOf('boolean');
      expect(a.idempotentHint, `${t.name} idempotentHint`).toBeTypeOf('boolean');
      expect(t.outputSchema, `${t.name} outputSchema`).toBeTruthy();
      const props = (t.inputSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
      for (const [k, p] of Object.entries(props)) expect(isFlat(p), `${t.name}.${k} flat`).toBe(true);
    }

    expect(calls).not.toHaveBeenCalled();
    await client.close();
  });
});
