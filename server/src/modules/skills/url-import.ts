import { assertHttpsAndNotBlocked, fetchAsText as fetchAsTextSafe } from '../../platform/safe-fetch.js';
import { IMPORT_LIMITS, parseFrontMatter, baseName, type SkillImportPreview } from './import-parser.js';

/**
 * URL-fetch import — see server/specs/skill-url-import.md for the full
 * design + the "why" behind every guard below. Separate from
 * import-parser.ts on purpose: that file is pure parsing (no I/O), this one
 * is the fetch/SSRF-safety concern.
 *
 * The actual SSRF-safe fetch guards (hostname blocklist, streamed byte cap,
 * abortable timeout, no redirect-following) live in
 * `platform/safe-fetch.ts` — shared across modules per `onion-architecture`
 * (a `modules/*` importing another module's internals laterally is a smell;
 * this is now a platform utility both Skills and the Intent classifier call
 * with their own limits). Re-exported here so existing callers/tests of
 * this module are unaffected.
 */

const FETCH_TIMEOUT_MS = 8_000;

export { assertHttpsAndNotBlocked };

/** `fetchAsText` pinned to Skills' own byte cap/timeout — see `platform/safe-fetch.ts` for the shared implementation. */
export async function fetchAsText(url: string): Promise<string> {
  return fetchAsTextSafe(url, { maxBytes: IMPORT_LIMITS.MAX_UPLOAD_BYTES, timeoutMs: FETCH_TIMEOUT_MS });
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
