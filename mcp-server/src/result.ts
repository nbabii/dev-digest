// MCP-facing envelope: ok() / capResponse() / toToolError().
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { MAX_ERROR_CHARS, MAX_RESPONSE_TOKENS, REQUEST_TIMEOUT_MS } from './constants.js';
import { McpToolError } from './errors.js';
import { decodeCursor, encodeCursor, estimateTokens, truncate } from './format.js';
import { ApiError } from './ports.js';

const MAX_SUMMARY_CHARS = 200;

/** structuredContent carries the data; text is one short human line, never a JSON copy. */
export function ok(summaryLine: string, data: Record<string, unknown>): CallToolResult {
  const line = truncate(summaryLine.replace(/\s+/g, ' ').trim(), MAX_SUMMARY_CHARS);
  return { content: [{ type: 'text', text: line }], structuredContent: data };
}

const size = (data: unknown): number => estimateTokens(JSON.stringify(data));

function truncateStrings(value: unknown, max: number): unknown {
  if (typeof value === 'string') return truncate(value, max);
  if (Array.isArray(value)) return value.map((v) => truncateStrings(v, max));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, truncateStrings(v, max)]));
  }
  return value;
}

/** Keeps the serialised payload within MAX_RESPONSE_TOKENS: shorten text, then drop trailing items. */
export function capResponse<T extends Record<string, unknown>>(data: T, maxTokens = MAX_RESPONSE_TOKENS): T {
  if (size(data) <= maxTokens) return data;

  let out = data as Record<string, unknown>;
  out = truncateStrings(out, 500) as Record<string, unknown>;
  if (size(out) <= maxTokens) return markTruncated(out, undefined, 0, 0) as T;

  // Trim the array that dominates the payload.
  let key: string | undefined;
  let biggest = -1;
  for (const [k, v] of Object.entries(out)) {
    if (Array.isArray(v)) {
      const s = JSON.stringify(v).length;
      if (s > biggest) {
        biggest = s;
        key = k;
      }
    }
  }
  if (!key) return markTruncated(truncateStrings(out, 120) as Record<string, unknown>, undefined, 0, 0) as T;

  const items = out[key] as unknown[];
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (size({ ...out, [key]: items.slice(0, mid), truncated: true, hint: '' }) <= maxTokens - 100) lo = mid;
    else hi = mid - 1;
  }
  return markTruncated({ ...out, [key]: items.slice(0, lo) }, key, items.length, lo) as T;
}

function markTruncated(out: Record<string, unknown>, key: string | undefined, before: number, kept: number): Record<string, unknown> {
  const result: Record<string, unknown> = { ...out, truncated: true };
  if (!key) {
    result.hint = 'response shortened to fit the size limit, narrow the request';
    return result;
  }
  const total = typeof out.total === 'number' ? out.total : before;
  result.hint = `showing ${kept} of ${total}, narrow with severity=critical or pass cursor`;
  // Re-point an existing offset cursor at the first dropped item.
  if (typeof out.next_cursor === 'string' && kept < before) {
    try {
      result.next_cursor = encodeCursor(decodeCursor(out.next_cursor) - (before - kept));
    } catch {
      delete result.next_cursor;
    }
  }
  return result;
}

function safeUrl(baseUrl: string): string {
  try {
    const u = new URL(baseUrl);
    u.username = '';
    u.password = '';
    return u.origin;
  } catch {
    return 'the configured URL';
  }
}

function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] };
}

/** Never includes stacks or raw internals; unknown errors are generic (details belong on stderr). */
export function toToolError(err: unknown, baseUrl: string): CallToolResult {
  if (err instanceof McpToolError) return errorResult(err.text);
  if (err instanceof ApiError) {
    switch (err.kind) {
      case 'unreachable':
        return errorResult(
          `DevDigest API not reachable at ${safeUrl(baseUrl)}. Next: start it with ./scripts/dev.sh (or set DEVDIGEST_API_URL)`,
        );
      case 'timeout':
        return errorResult(
          `DevDigest API did not answer within ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s. Next: retry in a moment, or check that the API is healthy`,
        );
      case 'rate_limited': {
        const secs = err.retryAfterMs !== undefined ? Math.max(1, Math.ceil(err.retryAfterMs / 1000)) : undefined;
        return errorResult(
          `Rate limited by the DevDigest API${secs ? `, retry in ~${secs}s` : ''}. Next: wait${secs ? ` ${secs}s` : ' a little'} and call again`,
        );
      }
      case 'shape':
        return errorResult('API response changed; update devdigest MCP to match. Next: update mcp-server to the API version in use');
      case 'http': {
        const status = err.status !== undefined ? ` (HTTP ${err.status})` : '';
        const msg = truncate(err.message, MAX_ERROR_CHARS).replace(/[.\s]+$/, '');
        return errorResult(`DevDigest API error${status}: ${msg}. Next: check the arguments, or call list_agents / get_findings to verify ids`);
      }
    }
  }
  return errorResult('Internal error; see stderr');
}
