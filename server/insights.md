# Insights — server

Non-obvious things learned while working in this module — discovered gotchas,
dead ends, decisions and the reasoning behind them, "why is it done this way"
answers. Captured by the `engineering-insights` skill. Append-only: never
rewrite or delete a past entry — a correction is a new dated entry that
references the old one. Check this file before deep-diving in this module.

## What Works

## What Doesn't Work

## Decisions

- **2026-09-16** — For the PR-list per-severity Findings column, chose one extra read-time aggregation query (`findings ⋈ reviews`, grouped in JS — same pattern as the existing score/cost lookups) over denormalized `critical_count`/`warning_count`/`suggestion_count` columns on `agent_runs`. Avoids keeping counters in sync on finding accept/dismiss and a migration; a prior attempt at the denormalized approach was already tried and reverted (see the `pnpm db:migrate` entry below, 2026-09-15) (`server/src/modules/pulls/routes.ts`, `server/specs/findings-counter.md`).

## Recurring Errors & Fixes

- **2026-09-15** — `pnpm db:migrate` fails with `column "X" of relation "Y" already exists` even on a freshly `git reset` starter tree: the local Postgres volume (`devdigest_pgdata`) is never wiped by a git revert, so it can still carry schema/data from previously-merged-then-reverted branches (e.g. `agent_runs.cost_usd` and unrelated leftover columns `critical_count`/`warning_count`/`suggestion_count` were already physically present before this session's migration re-added `cost_usd`). Before running `db:migrate` after picking up schema work, check the live DB first: `docker exec devdigest-postgres psql -U devdigest -d devdigest -c '\d <table>'` and `select * from drizzle.__drizzle_migrations`. If a column already exists and matches the intended schema, don't re-run the ALTER — baseline the generated migration as applied instead: `sha256` the migration `.sql` file (matches `drizzle-orm/postgres-js/migrator`'s `readMigrationFiles`, which hashes the raw file content) and `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('<sha256>', <journal "when" ms>)` — no data touched, journal reconciled with physical reality (`server/src/db/migrations/0010_superb_abomination.sql`).

## Codebase Patterns & Tool Notes

- **2026-09-16** — A `reviews` row (and its `findings`) is only ever persisted on the success path of `ReviewRunExecutor.executeRuns`, right before `completeAgentRun(runId, {status:'done',...})`; a failed/cancelled run hits the `catch` block instead and never inserts a `reviews` row at all. So any query that joins through `reviews` is already implicitly scoped to completed runs — no need to additionally join/filter on `agent_runs.status` (`server/src/modules/reviews/run-executor.ts:218-254,292-310`).

## Open Questions

- **2026-09-16** — Root `CLAUDE.md`'s gotcha "`*/src/vendor/` (client, server) — vendored third-party code (`@devdigest/ui`, `@devdigest/shared`); patch upstream, not in place" groups `@devdigest/shared` with `@devdigest/ui`, but no upstream/source-of-truth for `@devdigest/shared` appears to exist anywhere in this repo or as an installed package — `server/src/vendor/shared/contracts/platform.ts` and `client/src/vendor/shared/contracts/platform.ts` are byte-identical (checked via `diff`) with no sync script or build step found. Adding a field to `PrMeta` this session meant hand-editing both copies directly, which is the only way it seems editable at all. Worth confirming whether "patch upstream" ever applied to the shared contracts specifically (vs. just `@devdigest/ui`, which has a "ported from findings.jsx" comment implying a real prior source), or whether the `CLAUDE.md` wording should be split.

## Session Notes
