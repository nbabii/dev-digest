# Skill import — from URL

Fills in the one piece `server/specs/skills.md` explicitly deferred:
"`URL` and `Community` tabs ... are out of scope for this feature ... a
URL-fetch importer needs its own server-side fetch/SSRF-safety design this
spec doesn't cover." This spec is that design. No changes to the `Community`
tab (still out of scope, unrelated).

## Decisions (asked, answered)

- **URL scope: any `https://` URL**, not a host allowlist. Accepted with a
  disclosed trade-off — see SSRF section.
- **Flow shape: preview-then-confirm**, mirroring the existing "From file"
  wizard (`client/specs/skills.md`'s File panel), not a single-step
  fetch-and-save. The provided mockup shows URL + name + one button, but
  that's adapted into the wizard's **first step only** (URL entry, no name
  field yet) — name/description/type/body all become editable in the
  **confirm** step instead, exactly like the file flow. See client spec.
- **Markdown/text only** — no `.zip`-over-URL support. A URL pointing at an
  archive is out of scope; use the "From file" tab for that.
- **SSRF protection: simple hostname/IP-literal blocklist**, not
  resolve-DNS-then-pin. This is a deliberate, disclosed trade-off: a hostname
  whose DNS record initially resolves to a public IP but is later
  re-pointed to a private one (DNS rebinding) is not caught by this
  design. Mitigated partially by also rejecting redirects outright (see
  below) and by the fact that nothing acts on an imported skill's body
  until a human manually flips it `enabled` — but this is real residual
  risk, on record as an accepted one, not an oversight.

## Already in place, reused as-is

- `ImportSource = z.enum(['imported_url', 'extracted'])` and `POST
  /skills/import` (confirm route) already accept `source: 'imported_url'`
  and already force `enabled: false` on creation — **zero changes** to
  `server/src/modules/skills/routes.ts`'s confirm route or
  `SkillsService.confirmImport`. This spec adds exactly one new route: the
  URL-fetch preview.
- `parseFrontMatter(body)` (`server/src/modules/skills/import-parser.ts:71-97`)
  — the `name:`/`description:`/`type:` front-matter parser already built for
  file upload — reused verbatim on the fetched text.
- `IMPORT_LIMITS.MAX_UPLOAD_BYTES` (`import-parser.ts:30`, 5 MB) — reused as
  the fetch's byte cap, so both import paths share one size ceiling instead
  of two constants that could drift.
- `baseName(name)` (`import-parser.ts:59-63`) — reused for the
  URL-path-derived fallback name when front matter supplies none (same rule
  file import already uses for its filename).

## New route: `POST /skills/import/url-preview`

```ts
const UrlPreviewBody = z.object({ url: z.string().url() });
```

Same "preview only, nothing persisted" contract as `POST
/skills/import/preview`, returning the identical `SkillImportPreview` shape
(`import-parser.ts:42-52`) with `ignored` always omitted (not applicable —
no archive). Registered in `server/src/modules/skills/routes.ts` alongside
the existing import routes; no new module.

```ts
export async function buildUrlImportPreview(url: string): Promise<SkillImportPreview> {
  assertHttpsAndNotBlocked(url);           // throws ValidationError
  const body = await fetchAsText(url);     // throws ValidationError / ExternalServiceError
  const front = parseFrontMatter(body);
  return {
    name: front.name ?? baseName(new URL(url).pathname),
    description: front.description ?? '',
    type: front.type ?? 'custom',
    body,
    source: 'imported_url',
    evidence_files: [url],
  };
}
```

New file `server/src/modules/skills/url-import.ts` (parallel to
`import-parser.ts`, not merged into it — the fetch/SSRF concern is
distinct from the pure-parsing one that file already covers).

### `assertHttpsAndNotBlocked(url)`

1. `new URL(url)` — malformed URL → `ValidationError`.
2. `parsed.protocol !== 'https:'` → `ValidationError` (matches the UI's "URL
   (https:// only)" label being an actual server-enforced rule, not just
   copy).
3. Hostname blocklist (string-level, no DNS lookup) — **parses the IPv4
   octets first, then range-checks those**, rather than regex-matching the
   raw hostname string. A naive `/^10\./` prefix match would also reject the
   perfectly ordinary domain `10.example.com`, which is not an IP literal at
   all (caught by this file's own test suite during implementation):

```ts
function ipv4Octets(hostname: string): [number, number, number, number] | null { /* parses all-numeric a.b.c.d, else null */ }
function isBlockedIPv4(octets): boolean {
  const [a, b] = octets;
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0;
}
function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower === '0.0.0.0') return true;
  if (lower.endsWith('.local')) return true;
  if (lower === '::1' || lower === '[::1]') return true;              // `.hostname` KEEPS brackets for IPv6
  if (/^\[?f[cd][0-9a-f]{2}:/i.test(lower)) return true;               // IPv6 ULA (fc00::/7)
  const octets = ipv4Octets(lower);
  return octets ? isBlockedIPv4(octets) : false;
}
```
   Checked against `parsed.hostname`. Only an exact IP-literal match or an
   exact/suffix hostname match is ever blocked — an ordinary domain name
   always passes, which is exactly where the disclosed DNS-rebinding gap
   lives.

### `fetchAsText(url)`

- `fetch(url, { redirect: 'manual', signal })` — a 3xx response is treated
  as a failure (`ExternalServiceError`), not followed. This is the one
  extra guard layered on top of the "simple" tier: it closes off the most
  common way a hostname-only check gets bypassed (host A passes the
  blocklist, then 302s to `http://169.254.169.254/...`), for zero added
  complexity — no DNS/IP work needed, just refusing to auto-follow.
- Wrapped in `withTimeout(..., 8000)` (`server/src/platform/resilience.ts`,
  already used elsewhere in this codebase) — a hanging/slow host fails fast
  instead of tying up the request.
- Non-2xx status → `ExternalServiceError` with the status in the message.
- Body read via the stream (`response.body.getReader()`), accumulating
  chunks and aborting (via the same `AbortController` passed to `fetch`)
  the instant total bytes exceed `IMPORT_LIMITS.MAX_UPLOAD_BYTES` — a
  `Content-Length` header is untrustworthy (absent or spoofable), so the cap
  is enforced on bytes actually received, mirroring the spirit of
  `import-parser.ts`'s zip-bomb guard (decompressed-byte accounting, not a
  header check).
- Decode as UTF-8; if the buffer contains a `\0` byte (a cheap binary-content
  heuristic — there is no filename/extension here to gate on, unlike the
  file path's `.md`/`.txt` check), reject with `ValidationError` ("that
  doesn't look like a text file").

## Route wiring

```
POST /skills/import/url-preview   { url }  -> SkillImportPreview   (nothing persisted)
POST /skills/import                          -> unchanged, reused as the confirm step
```

`getContext(app.container, req)` for tenancy, same as every other
`skills/routes.ts` handler — the fetch itself is tenant-agnostic (no data
read/written per-workspace), the check exists only so an unauthenticated
caller can't hit this route at all, consistent with the rest of the module.

## Explicitly not doing

- No DNS-resolve-then-pin / IP-based SSRF hardening — see Decisions above,
  this is a recorded trade-off, not a gap to silently fix later without
  telling the user.
- No `.zip`-via-URL. No change to `extractZipCore`/the existing
  `POST /skills/import/preview` (multipart) route.
- No new job kind / async queue — this is a small, fast, timeout-bounded
  fetch, handled inline like the existing file-preview route, not through
  `JobRunner`.
- No changes to `POST /skills/import` (confirm) — it already does
  everything this flow needs (`source` forced consistent with what the
  preview computed via the client re-sending it, `enabled` forced `false`).
- No `Community` tab work — unrelated, still deferred.
- No allowlist config surface (e.g. a Settings toggle for "restrict import
  URLs to these hosts") — out of scope for this pass; the any-HTTPS
  decision above is fixed, not configurable, for now.
