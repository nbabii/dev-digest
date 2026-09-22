import { ValidationError, ExternalServiceError } from '../../platform/errors.js';
import { IMPORT_LIMITS, parseFrontMatter, baseName, type SkillImportPreview } from './import-parser.js';

/**
 * URL-fetch import — see server/specs/skill-url-import.md for the full
 * design + the "why" behind every guard below. Separate from
 * import-parser.ts on purpose: that file is pure parsing (no I/O), this one
 * is the fetch/SSRF-safety concern.
 *
 * SECURITY (accepted trade-off, on record — not an oversight): this is a
 * simple hostname/IP-literal blocklist, NOT a resolve-DNS-then-pin defense.
 * A hostname whose DNS answer changes after this check (rebinding) is not
 * caught. Partially mitigated by refusing to follow redirects at all.
 */

const FETCH_TIMEOUT_MS = 8_000;

/**
 * Only matches a hostname that IS an IPv4 literal (all four octets numeric,
 * nothing else) — NOT a prefix match. A naive `/^10\./` regex against the
 * raw hostname would also match the domain `10.example.com`, which is not
 * an IP literal at all; parsing the octets first and checking THOSE avoids
 * that false positive (caught by this file's own test suite).
 */
function ipv4Octets(hostname: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!m) return null;
  const octets = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as [number, number, number, number];
  return octets.every((o) => o <= 255) ? octets : null;
}

function isBlockedIPv4(octets: [number, number, number, number]): boolean {
  const [a, b] = octets;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata (169.254.169.254)
  if (a === 0) return true;
  return false;
}

function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower === '0.0.0.0') return true;
  if (lower.endsWith('.local')) return true;
  if (lower === '::1' || lower === '[::1]') return true; // IPv6 loopback — `.hostname` keeps the brackets
  if (/^\[?f[cd][0-9a-f]{2}:/i.test(lower)) return true; // IPv6 ULA (fc00::/7)
  const octets = ipv4Octets(lower);
  return octets ? isBlockedIPv4(octets) : false;
}

/** Parses + validates the URL: https-only, hostname not on the blocklist. */
export function assertHttpsAndNotBlocked(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError('Not a valid URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new ValidationError('Only https:// URLs are supported');
  }
  if (isBlockedHostname(parsed.hostname)) {
    throw new ValidationError('That host is not allowed');
  }
  return parsed;
}

/**
 * Fetches `url` as UTF-8 text: redirects are refused outright (not
 * followed), a timeout aborts the underlying request (not just the await —
 * see server/insights.md's JobRunner entry for why a timeout that doesn't
 * actually cancel the operation is its own bug class), and the byte cap is
 * enforced on bytes actually received while streaming, never trusting
 * `Content-Length`.
 */
export async function fetchAsText(url: string): Promise<string> {
  const sizeGuard = new AbortController();
  const signal = AbortSignal.any([AbortSignal.timeout(FETCH_TIMEOUT_MS), sizeGuard.signal]);

  let response: Response;
  try {
    response = await fetch(url, { redirect: 'manual', signal });
  } catch (err) {
    if (signal.aborted) {
      throw new ExternalServiceError(`Could not reach the URL within ${FETCH_TIMEOUT_MS}ms`);
    }
    throw new ExternalServiceError(`Could not reach the URL: ${(err as Error).message}`);
  }

  if (response.status >= 300 && response.status < 400) {
    throw new ExternalServiceError('Redirects are not followed for security reasons');
  }
  if (!response.ok) {
    throw new ExternalServiceError(`URL returned ${response.status} ${response.statusText}`);
  }
  if (!response.body) {
    throw new ExternalServiceError('Empty response body');
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > IMPORT_LIMITS.MAX_UPLOAD_BYTES) {
        sizeGuard.abort();
        throw new ValidationError(`Response exceeds the size limit (${IMPORT_LIMITS.MAX_UPLOAD_BYTES} bytes)`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  if (buffer.includes(0)) {
    throw new ValidationError("That doesn't look like a text file (binary content detected)");
  }
  return buffer.toString('utf-8');
}

/**
 * Pure-preview shape, same contract as `buildImportPreview` in
 * import-parser.ts — never persists anything.
 */
export async function buildUrlImportPreview(url: string): Promise<SkillImportPreview> {
  const parsed = assertHttpsAndNotBlocked(url);
  const body = await fetchAsText(url);
  const front = parseFrontMatter(body);
  return {
    name: front.name ?? baseName(parsed.pathname),
    description: front.description ?? '',
    type: front.type ?? 'custom',
    body,
    source: 'imported_url',
    evidence_files: [url],
  };
}
