import { describe, expect, it } from 'vitest';
import { McpToolError } from '../src/errors.js';
import { MAX_RESPONSE_TOKENS } from '../src/constants.js';
import { decodeCursor, encodeCursor, estimateTokens } from '../src/format.js';
import { ApiError } from '../src/ports.js';
import { capResponse, ok, toToolError } from '../src/result.js';

const URL_ = 'http://localhost:3001';
const text = (r: ReturnType<typeof toToolError>) => (r.content[0] as { text: string }).text;

describe('ok', () => {
  it('returns structuredContent and one short line, not a JSON copy', () => {
    const data = { findings: [{ title: 'x' }], total: 1 };
    const r = ok('1 finding, verdict approve', data);
    expect(r.structuredContent).toBe(data);
    expect(r.content).toHaveLength(1);
    const t = (r.content[0] as { text: string }).text;
    expect(t).toBe('1 finding, verdict approve');
    expect(t).not.toContain('{');
    expect(r.isError).toBeUndefined();
  });

  it('collapses newlines and caps length', () => {
    const t = (ok('a\nb ' + 'x'.repeat(1000), {}).content[0] as { text: string }).text;
    expect(t).not.toContain('\n');
    expect(t.length).toBeLessThanOrEqual(200);
  });
});

describe('capResponse', () => {
  const big = {
    verdict: 'comment',
    total: 1000,
    findings: Array.from({ length: 1000 }, (_, i) => ({ title: `finding ${i}`, at: `f${i}.ts:1-2`, body: 'y'.repeat(340) })),
  };

  it('leaves small payloads untouched', () => {
    const small = { findings: [{ title: 'a' }], total: 1 };
    expect(capResponse(small)).toBe(small);
  });

  it('trims a ~100k-token payload under the cap with truncated flag and hint', () => {
    expect(estimateTokens(JSON.stringify(big))).toBeGreaterThan(90_000);
    const out = capResponse(big) as Record<string, any>;
    expect(estimateTokens(JSON.stringify(out))).toBeLessThanOrEqual(MAX_RESPONSE_TOKENS);
    expect(out.truncated).toBe(true);
    const kept = out.findings.length;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(1000);
    expect(out.hint).toBe(`showing ${kept} of 1000, narrow with severity=critical or pass cursor`);
    expect(out.findings[0]).toEqual(big.findings[0]);
  });

  it('re-points next_cursor at the first dropped item', () => {
    const out = capResponse({ ...big, findings: big.findings.slice(0, 500), total: 1000, next_cursor: encodeCursor(500) }) as Record<string, any>;
    expect(decodeCursor(out.next_cursor)).toBe(out.findings.length);
  });

  it('shortens long text fields when that is enough', () => {
    const data = { items: [{ t: 'z'.repeat(200_000) }], total: 1 };
    const out = capResponse(data) as Record<string, any>;
    expect(estimateTokens(JSON.stringify(out))).toBeLessThanOrEqual(MAX_RESPONSE_TOKENS);
    expect(out.items).toHaveLength(1);
    expect(out.truncated).toBe(true);
  });
});

describe('toToolError', () => {
  it('maps McpToolError with its next step', () => {
    const r = toToolError(new McpToolError('Agent not found', 'call list_agents'), URL_);
    expect(r.isError).toBe(true);
    expect(text(r)).toBe('Agent not found. Next: call list_agents');
  });

  it('maps unreachable', () => {
    expect(text(toToolError(new ApiError('unreachable', 'ECONNREFUSED'), URL_))).toBe(
      'DevDigest API not reachable at http://localhost:3001. Next: start it with ./scripts/dev.sh (or set DEVDIGEST_API_URL)',
    );
  });

  it('never leaks credentials in the base URL', () => {
    const t = text(toToolError(new ApiError('unreachable', 'x'), 'http://user:pw@host:1/p'));
    expect(t).not.toContain('pw');
    expect(t).toContain('http://host:1');
  });

  it('maps timeout', () => {
    expect(text(toToolError(new ApiError('timeout', 'aborted'), URL_))).toMatch(/did not answer within 10s\. Next:/);
  });

  it('maps rate_limited with retry seconds', () => {
    expect(text(toToolError(new ApiError('rate_limited', 'x', { retryAfterMs: 4200 }), URL_))).toMatch(/retry in ~5s\. Next:/);
    expect(text(toToolError(new ApiError('rate_limited', 'x'), URL_))).toMatch(/Rate limited.*Next:/);
  });

  it('maps http with capped message', () => {
    const t = text(toToolError(new ApiError('http', 'm'.repeat(5000), { status: 404 }), URL_));
    expect(t).toContain('HTTP 404');
    expect(t).toMatch(/Next:/);
    expect(t.length).toBeLessThan(600);
  });

  it('maps shape', () => {
    expect(text(toToolError(new ApiError('shape', 'bad'), URL_))).toContain('API response changed; update devdigest MCP to match');
  });

  it('maps unknown errors generically with no stack or secrets', () => {
    const e = new Error('token sk-secret-123 leaked');
    const t = text(toToolError(e, URL_));
    expect(t).toBe('Internal error; see stderr');
    expect(t).not.toMatch(/sk-secret|at .*\(|\.ts:/);
    expect(text(toToolError('boom', URL_))).toBe('Internal error; see stderr');
  });

  it('never includes a stack for any kind', () => {
    for (const e of [new McpToolError('a', 'b'), new ApiError('http', 'x', { status: 500 }), new ApiError('shape', 'x')]) {
      expect(text(toToolError(e, URL_))).not.toMatch(/\n\s+at /);
    }
  });
});
