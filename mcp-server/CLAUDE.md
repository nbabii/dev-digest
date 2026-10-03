# mcp-server — @devdigest/mcp-server

Local **stdio** MCP server: a thin HTTP wrapper over the running DevDigest API
that lets an MCP client (Claude Code) list review agents, run one on a PR, and
read findings/conventions. Standalone package — installs, typechecks and tests
without `server/`, `reviewer-core/` or `client/` present. Usage and
registration → [README.md](README.md).

## Commands

`npm start` (stdio server) · `npm test` (vitest, hermetic — fake API port / local
`node:http`, no DB, no Docker) · `npm run typecheck`

## Map

Import direction is `tools → services → ports ← api-client` (enforced by
`test/guards.test.ts`); `main.ts` is the composition root.

- `src/tools/` — delivery: one file per tool (`list_agents`, `run_agent_on_pr`, `get_findings`, `get_conventions`, `get_blast_radius`). Thin: zod input → one service call → `ok()`. `descriptions.ts` holds the shipped description/instructions text (measured by `test/budget.test.ts`)
- `src/services/` — application: `resolve.ts` (owner/name, PR number, agent id|name → ids), `findings.ts` (findings, conventions, agents), `blast.ts` (PR blast radius: state to status/hint), `run-review.ts` (dedupe → start → poll → collect)
- `src/format.ts` — pure shaping: severity rank/filter, concise/detailed, cursor, `estimateTokens`
- `src/result.ts` — MCP envelope: `ok()`, `capResponse`, `toToolError`
- `src/ports.ts` — `DevDigestApi` interface, local wire types, `ApiError`
- `src/api-client.ts` — the only file that uses `fetch`; lenient local zod guards
- `src/main.ts` / `src/server.ts` — entrypoint / server assembly

## References

- [docs/plans/mcp-server.md](../docs/plans/mcp-server.md) — the plan and its decisions
- [insights.md](insights.md) — gotchas discovered while working here; check before deep-diving. New findings get appended here by the `engineering-insights` skill

## Gotchas

- **stdout is the protocol.** Never `console.log`/`process.stdout` in `src/` (guard test); logs go to stderr. `main.ts` redirects `console.log/info/debug` to stderr. Start with `npm --silent …` — npm's run banner otherwise corrupts stdout.
- **The API must be running** (`./scripts/dev.sh`); `dev.sh` does not start this server, the MCP client spawns it. Unreachable API → a forward-leading error, nothing is checked on connect.
- **Config:** `DEVDIGEST_API_URL` (default `http://localhost:3001`, non-loopback logs a warning), optional `DEVDIGEST_MCP_WAIT_MS` (run wait, default 90000).
- **No imports from `server/` or `@devdigest/*`.** API types are local lenient zod guards in `api-client.ts`. **Drift checklist:** if the API contract changes any field read there (repo `full_name`; PR `id`/`number`; agent `id`/`name`/`enabled`; run `run_id`/`status`/`agent_id`; review `run_id`/`verdict`/`findings[]` with `severity`/`file`/`start_line`/`dismissed_at`; conventions `scan`/`candidates`; blast `GET /pulls/:id/blast-radius`: `repo`, `pr_number`, `index.status|indexing|available|reason|facts_complete|last_indexed_sha`, `changed_files.*`, `totals.*`, `limits.*`, `symbols[].name|kind|file|line|exported|match|callers_total|endpoints_total|crons_total|endpoints_affected|crons_affected|callers[].name|file|line|url`), update the guards, `ports.ts` and `format.ts`. A mismatch surfaces as a `shape` error, not a crash.
- `run_agent_on_pr` is the only writer and is **not idempotent** after a run finishes; in-flight dedupe uses `GET /pulls/:id/runs/active` plus an in-process single-flight map (best effort — the API does not dedupe, and `POST /pulls/:id/review` is limited to 10/min).
- API severities are `CRITICAL|WARNING|SUGGESTION` (no `info`); the tool filter is the lowercase minimum level.
- PR lookup goes through `GET /repos/:id/pulls`, which syncs GitHub and writes the API cache — it can be slow; PR ids are cached per process.
- `zod` is `^3.25` because the MCP SDK's peer range requires it.
