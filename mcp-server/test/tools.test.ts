import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlastService } from '../src/services/blast.js';
import { createFindingsService } from '../src/services/findings.js';
import { createResolver } from '../src/services/resolve.js';
import { createRunReviewService } from '../src/services/run-review.js';
import { ApiError, type BlastRadiusReport, type DevDigestApi, type FindingRecord, type RunSummary } from '../src/ports.js';
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

const blastReport = (over: Partial<BlastRadiusReport> = {}): BlastRadiusReport => ({
  repo: 'acme/api',
  pr_number: 482,
  index: { status: 'ready', indexing: false, available: true, reason: null, facts_complete: true, last_indexed_sha: 'abc123' },
  changed_files: { total: 2, covered: 1, uncovered: ['src/new.ts'], no_symbol_touched: [], without_patch: 0, source: 'pr_files', truncated: false },
  // Deliberately inconsistent with the arrays: consumers must pass totals through.
  totals: { symbols: 2, callers: 14, endpoints: 3, crons: 1 },
  symbols: [
    {
      name: 'rateLimit', kind: 'function', file: 'src/middleware/ratelimit.ts', line: 10, exported: true, match: 'hunk',
      callers: [
        { name: 'publicItems', file: 'src/api/public/index.ts', line: 23, url: 'https://github.com/acme/api/blob/abc123/src/api/public/index.ts#L23' },
        { name: 'hook', file: 'src/api/hook.ts', line: 5, url: 'https://github.com/acme/api/blob/abc123/src/api/hook.ts#L5' },
      ],
      callers_total: 12, endpoints_total: 3, crons_total: 1,
      endpoints_affected: ['GET /api/public/items'], crons_affected: ['reset-buckets (hourly)'],
    },
    {
      name: 'bucketKey', kind: 'function', file: 'src/middleware/ratelimit.ts', line: 40, exported: true, match: 'file',
      callers: [], callers_total: 0, endpoints_total: 0, crons_total: 0, endpoints_affected: [], crons_affected: [],
    },
  ],
  limits: { symbols_truncated: false, callers_truncated: false },
  ...over,
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
    blastRadius: vi.fn(async () => blastReport()),
  } as Fake;
}

async function connect(api: Fake) {
  const port = api as unknown as DevDigestApi;
  const resolver = createResolver(port);
  const deps = {
    findings: createFindingsService(port, resolver),
    blast: createBlastService(port, resolver),
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

  it('get_blast_radius: one port call, totals pass through, concise shape', async () => {
    const r = await call(client, 'get_blast_radius', { repo: 'acme/api', pr: 482 });
    expect(api.blastRadius).toHaveBeenCalledTimes(1);
    expect(api.blastRadius).toHaveBeenCalledWith(PR_ID);
    expect(r.isError).toBeFalsy();
    const d = r.structuredContent;
    expect(d.status).toBe('ok');
    expect(d.totals).toEqual({ symbols: 2, callers: 14, endpoints: 3, crons: 1 });
    expect(d.symbols).toHaveLength(2);
    expect(d.symbols[0].callers).toEqual(['src/api/public/index.ts:23', 'src/api/hook.ts:5']);
    expect(d.symbols[0].endpoints).toEqual(['GET /api/public/items']);
    expect(d.symbols[0].match).toBeUndefined();
    expect(d.symbols[1].match).toBe('file');
    expect(r.content[0]!.text).toBe('acme/api#482 · 2 symbols · 14 callers · 3 endpoints · 1 cron · index ready');
    expect(r.content[0]!.text).not.toContain('{');
  });

  it('get_blast_radius: detailed adds caller objects with urls; symbol filters', async () => {
    const r = await call(client, 'get_blast_radius', { repo: 'acme/api', pr: 482, response_format: 'detailed', symbol: 'RATELIMIT' });
    const d = r.structuredContent;
    expect(d.symbols).toHaveLength(1);
    expect(d.symbols[0]).toMatchObject({ kind: 'function', line: 10, exported: true });
    expect(d.symbols[0].callers[0]).toEqual({
      name: 'publicItems', file: 'src/api/public/index.ts', line: 23,
      url: 'https://github.com/acme/api/blob/abc123/src/api/public/index.ts#L23',
    });
    expect(d.totals.symbols).toBe(2);
  });

  it('get_blast_radius: unknown symbol gives a hint, not an error', async () => {
    const r = await call(client, 'get_blast_radius', { repo: 'acme/api', pr: 482, symbol: 'nope' });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.symbols).toEqual([]);
    expect(r.structuredContent.hint).toContain('nope');
  });

  it.each([
    ['not_indexed', false, 'not indexed'],
    ['not_indexed', true, 'indexing in progress'],
    ['degraded', false, 'degraded'],
    ['disabled', false, 'disabled'],
  ])('get_blast_radius: %s (indexing=%s) is data with a hint, not an error', async (status, indexing, text) => {
    api.blastRadius.mockResolvedValueOnce(
      blastReport({
        index: { status, indexing, available: false, reason: null, facts_complete: false, last_indexed_sha: null },
        symbols: [],
        totals: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
      }),
    );
    const r = await call(client, 'get_blast_radius', { repo: 'acme/api', pr: 482 });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.status).toBe('index_unavailable');
    expect(r.structuredContent.hint).toContain(text);
  });

  it('get_blast_radius: partial index flags incomplete facts; no changed files has its own status', async () => {
    api.blastRadius.mockResolvedValueOnce(
      blastReport({ index: { status: 'partial', indexing: false, available: true, reason: 'soft_budget', facts_complete: false, last_indexed_sha: 'a' } }),
    );
    const p = await call(client, 'get_blast_radius', { repo: 'acme/api', pr: 482 });
    expect(p.structuredContent.status).toBe('ok');
    expect(p.structuredContent.hint).toContain('endpoints/crons may be incomplete');

    api.blastRadius.mockResolvedValueOnce(
      blastReport({ changed_files: { total: 0, covered: 0, uncovered: [], no_symbol_touched: [], without_patch: 0, source: 'none', truncated: false }, symbols: [] }),
    );
    const n = await call(client, 'get_blast_radius', { repo: 'acme/api', pr: 482 });
    expect(n.structuredContent.status).toBe('no_changed_files');
    expect(n.structuredContent.hint).toContain('open the PR once');
  });

  it('get_blast_radius: API errors go through toToolError', async () => {
    api.blastRadius.mockRejectedValueOnce(new ApiError('http', 'Pull request not found', { status: 404 }));
    const r = await call(client, 'get_blast_radius', { repo: 'acme/api', pr: 482 });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain('HTTP 404');
  });

  it('get_blast_radius: oversized response is capped with a symbol= hint and keeps totals', async () => {
    const big = Array.from({ length: 60 }, (_, i) => ({
      name: `sym${i}`, kind: 'function', file: `src/f${i}.ts`, line: i, exported: true, match: 'hunk',
      callers: Array.from({ length: 20 }, (_, j) => ({ name: `c${j}`, file: `src/caller${i}_${j}.ts`, line: j + 1, url: `https://github.com/acme/api/blob/abc/src/caller${i}_${j}.ts#L${j + 1}` })),
      callers_total: 20, endpoints_total: 0, crons_total: 0, endpoints_affected: [], crons_affected: [],
    }));
    api.blastRadius.mockResolvedValueOnce(blastReport({ symbols: big, totals: { symbols: 30, callers: 600, endpoints: 0, crons: 0 } }));
    const r = await call(client, 'get_blast_radius', { repo: 'acme/api', pr: 482, response_format: 'detailed' });
    expect(r.structuredContent.truncated).toBe(true);
    expect(r.structuredContent.hint).toContain('symbol=<name>');
    expect(r.structuredContent.hint).not.toContain('severity');
    expect(r.structuredContent.totals.callers).toBe(600);
    expect(r.structuredContent.symbols.length).toBeLessThan(60);
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
