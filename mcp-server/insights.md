# Insights — mcp-server

Non-obvious things learned while working in this module — discovered gotchas,
dead ends, decisions and the reasoning behind them, "why is it done this way"
answers. Captured by the `engineering-insights` skill. Append-only: never
rewrite or delete a past entry — a correction is a new dated entry that
references the old one. Check this file before deep-diving in this module.

## What Works

- **2026-09-30** — `npm --silent --prefix <abs>/mcp-server start` leaves stdout clean (only JSON-RPC lines), same as running `node_modules/.bin/tsx src/main.ts` directly. Verified by piping `initialize` + `tools/list` + a `tools/call` into a real process.

## What Doesn't Work

## Decisions

- **2026-09-30** — Standalone package with local lenient zod guards instead of a type-only alias to `server/src/vendor/shared`: the alias would make typecheck/CI depend on `../server` being present. Cost: API contract drift is caught at runtime as a `shape` error, not at compile time — see the drift checklist in `CLAUDE.md`.
- **2026-09-30** — Layering by analogy with the backend onion rule (`tools → services → ports ← api-client`), enforced by a static import-direction test (`test/guards.test.ts`) rather than dependency-cruiser, to keep the package dependency-free of `server/` tooling.

## Recurring Errors & Fixes

## Codebase Patterns & Tool Notes

- **2026-10-03** — `capResponse` replaces `hint` when it truncates, so `get_blast_radius` re-appends its state hint (index/partial) after capping, and passes `{ narrowHint: 'narrow with symbol=<name>' }` since the default tail mentions `severity=critical` (`src/tools/get-blast-radius.ts`, `src/result.ts`). Blast `totals` are passed through from the API, never summed from the capped arrays.
- **2026-09-30** — The MCP SDK (1.31) peers on `zod ^3.25 || ^4`, so this package pins `zod ^3.25.0`, not the `^3.24.1` used in `server/`.
- **2026-09-30** — The API's finding severities are only `CRITICAL|WARNING|SUGGESTION` (`server/src/vendor/shared/contracts/findings.ts`); an earlier plan draft listed an `info` level that does not exist.

## Open Questions

- The API's `Retry-After` header on 429 was not found in `server/src/app.ts`; the client treats a missing header as unknown and falls back to a default backoff. Unverified whether `@fastify/rate-limit` sets it with the current config.
- Real `MCP_TOOL_TIMEOUT` of the client is unverified; the 90 s wait with a `running` + `run_id` fallback is safe under any value.

## Session Notes
