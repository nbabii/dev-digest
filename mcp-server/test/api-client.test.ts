import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../src/api-client.js';
import { resolveApiUrl } from '../src/config.js';
import { ApiError } from '../src/ports.js';

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

let server: Server;
let baseUrl: string;
let handler: Handler;
const seen: { method?: string; url?: string; body: string }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      seen.push({ method: req.method, url: req.url, body });
      handler(req, res, body);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

function json(res: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(payload));
}

async function rejection(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error('expected rejection');
}

const repo = { id: 'r1', owner: 'acme', name: 'web', full_name: 'acme/web', extra: { a: 1 } };
const finding = {
  id: 'f1',
  severity: 'CRITICAL',
  category: 'security',
  title: 'SQL injection',
  file: 'src/db.ts',
  start_line: 10,
  end_line: 12,
  rationale: 'Unparameterised query',
  suggestion: null,
  confidence: 0.9,
  accepted_at: null,
  dismissed_at: null,
  unknown_future_field: true,
};

describe('ApiClient happy paths (real HTTP)', () => {
  it('listRepos', async () => {
    handler = (_q, res) => json(res, 200, [repo]);
    const out = await new ApiClient(baseUrl).listRepos();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'r1', full_name: 'acme/web' });
    expect(seen.at(-1)).toMatchObject({ method: 'GET', url: '/repos' });
  });

  it('listPulls encodes the id and tolerates a missing pr id', async () => {
    handler = (_q, res) =>
      json(res, 200, [{ number: 7, title: 'Add x', head_sha: 'abc', status: 'needs_review', author: 'bob' }]);
    const out = await new ApiClient(baseUrl).listPulls('a/b c');
    expect(out[0]).toMatchObject({ number: 7, status: 'needs_review' });
    expect(seen.at(-1)?.url).toBe('/repos/a%2Fb%20c/pulls');
  });

  it('listAgents ignores system_prompt and other extras', async () => {
    handler = (_q, res) =>
      json(res, 200, [
        { id: 'a1', name: 'Security', description: 'sec', provider: 'anthropic', model: 'm', enabled: true, system_prompt: 'SECRET' },
      ]);
    const out = await new ApiClient(baseUrl).listAgents();
    expect(out[0]).toMatchObject({ id: 'a1', enabled: true });
  });

  it('startReview POSTs {agentId}', async () => {
    handler = (_q, res) =>
      json(res, 202, { pr_id: 'p1', runs: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'Security' }], reviews: [] });
    const out = await new ApiClient(baseUrl).startReview('p1', 'a1');
    expect(out).toEqual({ pr_id: 'p1', runs: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'Security' }] });
    const last = seen.at(-1)!;
    expect(last).toMatchObject({ method: 'POST', url: '/pulls/p1/review' });
    expect(JSON.parse(last.body)).toEqual({ agentId: 'a1' });
  });

  it('activeRuns', async () => {
    handler = (_q, res) => json(res, 200, [{ run_id: 'run1', agent_id: null, agent_name: null, ran_at: '2026-01-01T00:00:00Z' }]);
    const out = await new ApiClient(baseUrl).activeRuns('p1');
    expect(out[0]).toMatchObject({ run_id: 'run1', agent_id: null });
    expect(seen.at(-1)?.url).toBe('/pulls/p1/runs/active');
  });

  it('listRuns', async () => {
    handler = (_q, res) =>
      json(res, 200, [
        { run_id: 'run1', agent_id: 'a1', agent_name: 'Security', status: 'done', error: null, findings_count: 2, score: 80, ran_at: '2026-01-01T00:00:00Z' },
        { run_id: 'run0', status: 'failed', error: 'boom' },
      ]);
    const out = await new ApiClient(baseUrl).listRuns('p1');
    expect(out[0]).toMatchObject({ status: 'done', findings_count: 2 });
    expect(out[1]).toMatchObject({ status: 'failed', error: 'boom', agent_id: null, score: null });
    expect(seen.at(-1)?.url).toBe('/pulls/p1/runs');
  });

  it('reviewsForPull', async () => {
    handler = (_q, res) =>
      json(res, 200, [
        { run_id: 'run1', agent_id: 'a1', verdict: 'request_changes', summary: 's', score: 40, created_at: '2026-01-01T00:00:00Z', findings: [finding] },
      ]);
    const out = await new ApiClient(baseUrl).reviewsForPull('p1');
    expect(out[0]?.findings[0]).toMatchObject({ id: 'f1', severity: 'CRITICAL', suggestion: null, dismissed_at: null });
    expect(seen.at(-1)?.url).toBe('/pulls/p1/reviews');
  });

  it('blastRadius: GET /pulls/:id/blast-radius, lenient guard, shape error on drift', async () => {
    const wire = {
      repo: 'acme/api', pr_id: 'p1', pr_number: 482, future_field: 1,
      index: { status: 'ready', indexing: false, available: true, reason: null, facts_complete: true, last_indexed_sha: null, indexed_at: null },
      changed_files: { total: 1, covered: 1, uncovered: [], no_symbol_touched: [], without_patch: 0, source: 'pr_files', truncated: false },
      totals: { symbols: 1, callers: 1, endpoints: 0, crons: 0 },
      symbols: [{
        name: 'f', kind: 'function', file: 'a.ts', line: null, exported: true, match: 'hunk',
        callers: [{ name: 'g', file: 'b.ts', line: 3, url: 'u' }],
        callers_total: 1, endpoints_total: 0, crons_total: 0, endpoints_affected: [], crons_affected: [], symbol: 'f',
      }],
      limits: { symbols_truncated: false, callers_truncated: false },
    };
    handler = (_q, res) => json(res, 200, wire);
    const out = await new ApiClient(baseUrl).blastRadius('p/1');
    expect(seen.at(-1)?.url).toBe('/pulls/p%2F1/blast-radius');
    expect(out.index.last_indexed_sha).toBeNull();
    expect(out.symbols[0]!.callers[0]).toEqual({ name: 'g', file: 'b.ts', line: 3, url: 'u' });
    expect(out).not.toHaveProperty('pr_id');

    handler = (_q, res) => json(res, 200, { ...wire, totals: undefined });
    expect((await rejection(new ApiClient(baseUrl).blastRadius('p1'))).kind).toBe('shape');
  });

  it('conventions with and without a scan', async () => {
    const candidate = {
      id: 'c1',
      category: 'naming',
      rule: 'Use camelCase',
      evidence_path: 'src/a.ts',
      evidence_line_start: 1,
      evidence_line_end: 3,
      confidence: 0.8,
      status: 'accepted',
    };
    handler = (_q, res) =>
      json(res, 200, {
        scan: { id: 's1', status: 'completed', candidates_found: 1, started_at: '2026-01-01T00:00:00Z' },
        candidates: [candidate],
      });
    const client = new ApiClient(baseUrl);
    const out = await client.conventions('r1');
    expect(out.scan).toMatchObject({ id: 's1', error: null, finished_at: null });
    expect(out.candidates).toHaveLength(1);
    expect(seen.at(-1)?.url).toBe('/repos/r1/conventions');

    handler = (_q, res) => json(res, 200, { scan: null, candidates: [] });
    expect(await client.conventions('r1')).toEqual({ scan: null, candidates: [] });
  });

  it('strips a trailing slash from the base URL', async () => {
    handler = (_q, res) => json(res, 200, []);
    await new ApiClient(`${baseUrl}/`).listRepos();
    expect(seen.at(-1)?.url).toBe('/repos');
  });
});

describe('ApiClient error mapping', () => {
  it('429 with Retry-After seconds -> rate_limited with retryAfterMs', async () => {
    handler = (_q, res) => json(res, 429, { error: { code: 'RATE_LIMITED', message: 'slow down' } }, { 'retry-after': '7' });
    const err = await rejection(new ApiClient(baseUrl).listRepos());
    expect(err).toMatchObject({ kind: 'rate_limited', status: 429, retryAfterMs: 7000 });
  });

  it('429 without Retry-After -> retryAfterMs undefined', async () => {
    handler = (_q, res) => json(res, 429, {});
    const err = await rejection(new ApiClient(baseUrl).listRepos());
    expect(err.kind).toBe('rate_limited');
    expect(err.retryAfterMs).toBeUndefined();
  });

  it('429 with an unparseable Retry-After -> undefined', async () => {
    handler = (_q, res) => json(res, 429, {}, { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' });
    const err = await rejection(new ApiClient(baseUrl).listRepos());
    expect(err.retryAfterMs).toBeUndefined();
  });

  it('maps the {error:{code,message}} envelope to http', async () => {
    handler = (_q, res) => json(res, 404, { error: { code: 'NOT_FOUND', message: 'Repo not found' } });
    const err = await rejection(new ApiClient(baseUrl).listPulls('nope'));
    expect(err).toMatchObject({ kind: 'http', status: 404, code: 'NOT_FOUND', message: 'Repo not found' });
  });

  it('caps an oversized envelope message', async () => {
    handler = (_q, res) => json(res, 422, { error: { code: 'X', message: 'y'.repeat(5000) } });
    const err = await rejection(new ApiClient(baseUrl).listRepos());
    expect(err.kind).toBe('http');
    expect(err.message.length).toBeLessThan(400);
  });

  it('non-2xx without an envelope never leaks the body', async () => {
    handler = (_q, res) => {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('Error: secret stack\n    at /srv/app.js:1:1');
    };
    const err = await rejection(new ApiClient(baseUrl).listRepos());
    expect(err).toMatchObject({ kind: 'http', status: 500 });
    expect(err.message).not.toContain('secret');
    expect(err.message).not.toContain('/srv/app.js');
  });

  it('non-JSON 200 body -> shape', async () => {
    handler = (_q, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>proxy error</html>');
    };
    const err = await rejection(new ApiClient(baseUrl).listRepos());
    expect(err.kind).toBe('shape');
  });

  it('empty 200 body -> shape', async () => {
    handler = (_q, res) => {
      res.writeHead(200);
      res.end();
    };
    expect((await rejection(new ApiClient(baseUrl).listRepos())).kind).toBe('shape');
  });

  it('connection refused (closed port) -> unreachable', async () => {
    const probe = createServer();
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((r) => probe.close(() => r()));
    const err = await rejection(new ApiClient(`http://127.0.0.1:${port}`).listRepos());
    expect(err.kind).toBe('unreachable');
    expect(err.message).toContain(`127.0.0.1:${port}`);
    expect(err.stack ?? '').not.toContain('ECONNREFUSED');
  });
});

describe('ApiClient with injected fetch', () => {
  it('passes an abort signal on every call', async () => {
    const fake = vi.fn(async () => new Response('[]', { status: 200 }));
    const c = new ApiClient('http://x', fake as unknown as typeof fetch);
    await c.listRepos();
    await c.listAgents();
    await c.activeRuns('p');
    for (const call of fake.mock.calls as unknown as [string, RequestInit][]) {
      expect(call[1].signal).toBeInstanceOf(AbortSignal);
    }
    expect(fake).toHaveBeenCalledTimes(3);
  });

  it('TimeoutError -> timeout', async () => {
    const fake = vi.fn(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    const err = await rejection(new ApiClient('http://x', fake as unknown as typeof fetch).listRepos());
    expect(err.kind).toBe('timeout');
  });

  it('a hung fetch honouring the signal -> timeout (real AbortSignal.timeout)', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => AbortSignal.abort(new DOMException('t', 'TimeoutError')));
    try {
      const fake = vi.fn(
        (_u: unknown, init?: RequestInit) =>
          new Promise<Response>((_res, rej) => {
            init?.signal?.addEventListener('abort', () => rej(init.signal!.reason));
            if (init?.signal?.aborted) rej(init.signal.reason);
          }),
      );
      const err = await rejection(new ApiClient('http://x', fake as unknown as typeof fetch).listAgents());
      expect(err.kind).toBe('timeout');
    } finally {
      spy.mockRestore();
    }
  });

  it('fetch failed TypeError -> unreachable', async () => {
    const fake = vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    });
    const err = await rejection(new ApiClient('http://x', fake as unknown as typeof fetch).listRepos());
    expect(err.kind).toBe('unreachable');
  });
});

describe('lenient guards', () => {
  const clientFor = (payload: unknown) =>
    new ApiClient('http://x', (async () => new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch);

  it('accepts extra fields and drops them', async () => {
    const out = await clientFor([{ ...repo, brand_new: 1 }]).listRepos();
    expect(out[0]).not.toHaveProperty('brand_new');
  });

  it('accepts unknown enum values', async () => {
    const out = await clientFor([{ number: 1, title: 't', head_sha: 'h', status: 'quantum' }]).listPulls('r');
    expect(out[0]?.status).toBe('quantum');
  });

  it('rejects a missing required field -> shape', async () => {
    const { full_name: _omit, ...broken } = repo;
    const err = await rejection(clientFor([broken]).listRepos());
    expect(err.kind).toBe('shape');
  });

  it('rejects a wrong top-level type -> shape', async () => {
    const err = await rejection(clientFor({ repos: [] }).listRepos());
    expect(err.kind).toBe('shape');
  });

  it('rejects a finding without a line -> shape', async () => {
    const { start_line: _s, ...broken } = finding;
    const err = await rejection(
      clientFor([{ run_id: 'r', created_at: 'now', findings: [broken] }]).reviewsForPull('p'),
    );
    expect(err.kind).toBe('shape');
  });

  it('shape errors carry no response body', async () => {
    const err = await rejection(clientFor([{ id: 'TOPSECRET' }]).listRepos());
    expect(err.message).not.toContain('TOPSECRET');
  });
});

describe('resolveApiUrl', () => {
  it('defaults to localhost:3001, loopback', () => {
    expect(resolveApiUrl({})).toEqual({ url: 'http://localhost:3001', warnNonLoopback: false });
  });

  it('treats an empty value as unset', () => {
    expect(resolveApiUrl({ DEVDIGEST_API_URL: '  ' }).url).toBe('http://localhost:3001');
  });

  it('strips trailing slashes', () => {
    expect(resolveApiUrl({ DEVDIGEST_API_URL: 'http://127.0.0.1:4000//' })).toEqual({
      url: 'http://127.0.0.1:4000',
      warnNonLoopback: false,
    });
  });

  it('keeps a path prefix', () => {
    expect(resolveApiUrl({ DEVDIGEST_API_URL: 'http://localhost:3001/api/' }).url).toBe('http://localhost:3001/api');
  });

  it('IPv6 loopback is loopback', () => {
    expect(resolveApiUrl({ DEVDIGEST_API_URL: 'http://[::1]:3001' }).warnNonLoopback).toBe(false);
  });

  it('warns for non-loopback hosts', () => {
    expect(resolveApiUrl({ DEVDIGEST_API_URL: 'https://devdigest.example.com' })).toEqual({
      url: 'https://devdigest.example.com',
      warnNonLoopback: true,
    });
    expect(resolveApiUrl({ DEVDIGEST_API_URL: 'http://192.168.1.5:3001' }).warnNonLoopback).toBe(true);
  });

  it('rejects non-http protocols and garbage', () => {
    expect(() => resolveApiUrl({ DEVDIGEST_API_URL: 'file:///etc/passwd' })).toThrow(/http/);
    expect(() => resolveApiUrl({ DEVDIGEST_API_URL: 'ftp://x' })).toThrow(/http/);
    expect(() => resolveApiUrl({ DEVDIGEST_API_URL: 'not a url' })).toThrow(/valid URL/);
  });
});
