import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFindingsService } from '../src/services/findings.js';
import { createResolver } from '../src/services/resolve.js';
import { createRunReviewService } from '../src/services/run-review.js';
import { ApiError, type DevDigestApi, type FindingRecord, type RunSummary } from '../src/ports.js';
import { registerGetBlastRadius } from '../src/tools/get-blast-radius.js';
import { registerGetConventions } from '../src/tools/get-conventions.js';
import { registerGetFindings } from '../src/tools/get-findings.js';
import { registerListAgents } from '../src/tools/list-agents.js';
import { registerRunAgentOnPr } from '../src/tools/run-agent-on-pr.js';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const AGENT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const RUN_ID = 'rrrrrrrr-run';
const PR_ID = 'pppppppp-pr';

const finding = (n: number, severity: string, extra: Partial<FindingRecord> = {}): FindingRecord => ({
  id: `bbbbbbbb-0000-4000-8000-00000000000${n}`,
  severity,
  category: 'bug',
  title: `Finding ${n}`,
  file: `src/f${n}.ts`,
  start_line: n,
  end_line: n + 1,
  rationale: 'because',
  suggestion: 'fix it',
  confidence: 0.9,
  accepted_at: null,
  dismissed_at: null,
  ...extra,
});

type Fake = { [K in keyof DevDigestApi]: ReturnType<typeof vi.fn> };

function makeApi(): Fake {
  const done: RunSummary = {
    run_id: RUN_ID, agent_id: AGENT_ID, agent_name: 'Security', status: 'done',
    error: null, findings_count: 3, score: 80, ran_at: null,
  };
  return {
    listRepos: vi.fn(async () => [{ id: 'rrrr-repo', owner: 'acme', name: 'api', full_name: 'acme/api' }]),
    listPulls: vi.fn(async () => [{ id: PR_ID, number: 482, title: 'SECRET TITLE', head_sha: 'abc', status: 'open' }]),
    listAgents: vi.fn(async () => [
      { id: AGENT_ID, name: 'Security', description: 'd', provider: 'anthropic', model: 'm', enabled: true, system_prompt: 'LEAK' },
    ]),
    startReview: vi.fn(async () => ({ pr_id: PR_ID, runs: [{ run_id: RUN_ID, agent_id: AGENT_ID, agent_name: 'Security' }] })),
    activeRuns: vi.fn(async () => []),
    listRuns: vi.fn(async () => [done]),
    reviewsForPull: vi.fn(async () => [
      {
        run_id: RUN_ID, agent_id: AGENT_ID, verdict: 'request_changes', summary: null, score: 80,
        created_at: 'now',
        findings: [
          finding(1, 'SUGGESTION'),
          finding(2, 'CRITICAL'),
          finding(3, 'WARNING'),
          finding(4, 'CRITICAL', { dismissed_at: 'x' }),
        ],
      },
    ]),
    conventions: vi.fn(async () => ({ scan: null, candidates: [] })),
  } as Fake;
}

async function connect(api: Fake) {
  const port = api as unknown as DevDigestApi;
  const resolver = createResolver(port);
  const deps = {
    findings: createFindingsService(port, resolver),
    runReview: createRunReviewService(port, resolver, { waitMs: 3, pollMs: 1, sleep: async () => {}, now: (() => { let t = 0; return () => t++; })() }),
    baseUrl: 'http://localhost:3001',
  };
  const server = new McpServer({ name: 't', version: '0' });
  registerListAgents(server, deps);
  registerRunAgentOnPr(server, deps);
  registerGetFindings(server, deps);
  registerGetConventions(server, deps);
  registerGetBlastRadius(server, deps);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

type Result = { isError?: boolean; content: Array<{ type: string; text: string }>; structuredContent?: any };
const call = async (c: Client, name: string, args: Record<string, unknown>) =>
  (await c.callTool({ name, arguments: args })) as unknown as Result;

describe('tools', () => {
  let api: Fake;
  let client: Client;
  beforeEach(async () => {
    api = makeApi();
    client = await connect(api);
  });

  it('lists the five tools with annotations and flat inputs', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['get_blast_radius', 'get_conventions', 'get_findings', 'list_agents', 'run_agent_on_pr'],
    );
    for (const t of tools) {
      expect(t.outputSchema).toBeTruthy();
      const props = (t.inputSchema.properties ?? {}) as Record<string, { type?: string }>;
      for (const p of Object.values(props)) expect(['string', 'integer', 'number', 'boolean']).toContain(p.type);
      if (t.name === 'run_agent_on_pr') {
        expect(t.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });
      } else {
        expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
      }
    }
    const sev = (tools.find((t) => t.name === 'get_findings')!.inputSchema.properties as any).severity;
    expect(sev.enum).toEqual(['critical', 'warning', 'suggestion']);
  });

  it('list_agents returns ids and never system_prompt', async () => {
    const r = await call(client, 'list_agents', {});
    expect(r.structuredContent.agents[0].id).toBe(AGENT_ID);
    expect(JSON.stringify(r)).not.toContain('system_prompt');
    expect(JSON.stringify(r)).not.toContain('LEAK');
  });

  it('run_agent_on_pr done path: structuredContent + one short line, no PR title', async () => {
    const r = await call(client, 'run_agent_on_pr', { repo: 'acme/api', pr: 482, agent: 'Security' });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ status: 'done', verdict: 'request_changes', run_id: RUN_ID, total: 3 });
    expect(r.content).toHaveLength(1);
    const text = r.content[0]!.text;
    expect(text).toBe('acme/api#482 · Security · request_changes · 3 findings');
    expect(text).not.toContain('SECRET TITLE');
    expect(api.startReview).toHaveBeenCalledTimes(1);
  });

  it('run_agent_on_pr falls back to running with run_id', async () => {
    api.listRuns.mockResolvedValue([{ run_id: RUN_ID, agent_id: AGENT_ID, status: 'running', error: null, findings_count: null, score: null, agent_name: null, ran_at: null }]);
    const r = await call(client, 'run_agent_on_pr', { repo: 'acme/api', pr: 482, agent: AGENT_ID });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ status: 'running', run_id: RUN_ID });
    expect(r.structuredContent.hint).toContain('get_findings');
  });

  it('run_agent_on_pr reports failed without a stack', async () => {
    api.listRuns.mockResolvedValue([{ run_id: RUN_ID, agent_id: AGENT_ID, status: 'failed', error: 'boom\n    at x (y.ts:1)', findings_count: null, score: null, agent_name: null, ran_at: null }]);
    const r = await call(client, 'run_agent_on_pr', { repo: 'acme/api', pr: 482, agent: 'Security' });
    expect(r.structuredContent).toMatchObject({ status: 'failed', error: 'boom' });
  });

  it('errors lead forward: agent not found', async () => {
    const r = await call(client, 'run_agent_on_pr', { repo: 'acme/api', pr: 482, agent: 'nope' });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/Next: .*list_agents/);
    expect(api.startReview).not.toHaveBeenCalled();
  });

  it('errors lead forward: API unreachable mentions ./scripts/dev.sh', async () => {
    api.listRepos.mockRejectedValue(new ApiError('unreachable', 'ECONNREFUSED'));
    const r = await call(client, 'get_findings', { repo: 'acme/api', pr: 482 });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain('Next:');
    expect(r.content[0]!.text).toContain('./scripts/dev.sh');
  });

  it('get_findings: default newest done run, dismissed excluded, sorted, concise has no ids', async () => {
    const r = await call(client, 'get_findings', { repo: 'acme/api', pr: 482 });
    const f = r.structuredContent.findings;
    expect(f.map((x: any) => x.severity)).toEqual(['critical', 'warning', 'suggestion']);
    expect(r.structuredContent.total).toBe(3);
    const stripped = JSON.stringify(r.structuredContent).replace(RUN_ID, '');
    expect(stripped).not.toMatch(UUID);
    expect(f[0].id).toBeUndefined();
  });

  it('get_findings: severity minimum level, detailed adds ids', async () => {
    const r = await call(client, 'get_findings', { repo: 'acme/api', pr: 482, severity: 'warning', response_format: 'detailed' });
    expect(r.structuredContent.findings.map((x: any) => x.severity)).toEqual(['critical', 'warning']);
    expect(r.structuredContent.findings[0].id).toMatch(UUID);
  });

  it('get_findings: pagination with cursor', async () => {
    const p1 = await call(client, 'get_findings', { repo: 'acme/api', pr: 482, limit: 2 });
    expect(p1.structuredContent.findings).toHaveLength(2);
    expect(p1.structuredContent.next_cursor).toBeTruthy();
    const p2 = await call(client, 'get_findings', { repo: 'acme/api', pr: 482, limit: 2, cursor: p1.structuredContent.next_cursor });
    expect(p2.structuredContent.findings).toHaveLength(1);
    expect(p2.structuredContent.next_cursor).toBeUndefined();
  });

  it('get_findings: garbage cursor is a forward-leading error', async () => {
    const r = await call(client, 'get_findings', { repo: 'acme/api', pr: 482, cursor: '!!!' });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain('Next:');
  });

  it('get_conventions: no scan', async () => {
    const r = await call(client, 'get_conventions', { repo: 'acme/api' });
    expect(r.structuredContent.status).toBe('no_scan');
    expect(r.isError).toBeFalsy();
  });

  it('get_blast_radius is static and makes zero port calls', async () => {
    const r = await call(client, 'get_blast_radius', { repo: 'acme/api', pr: 482 });
    expect(r.structuredContent).toEqual({ status: 'not_implemented' });
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });

  it('rejects invalid input', async () => {
    const bad = [
      call(client, 'get_findings', { repo: 'acme/api', pr: 482, severity: 'info' }),
      call(client, 'get_findings', { repo: 'acme/api', pr: 482, limit: 51 }),
      call(client, 'run_agent_on_pr', { repo: 'acme/api', pr: 'x', agent: 'a' }),
    ];
    for (const p of bad) {
      const r = await p.catch((e) => ({ isError: true, content: [{ text: String(e) }] }));
      expect(r.isError).toBe(true);
    }
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });
});
