# Findings counter — server

Surfaces a per-severity findings count on the PR list, closing the gap called
out in `pulls/routes.ts`: *"the per-severity FINDINGS breakdown is
intentionally not surfaced on the list"*.

## Severity taxonomy

Reuses the existing 3-tier `Severity` enum — `CRITICAL | WARNING | SUGGESTION`
(`src/vendor/shared/contracts/findings.ts`). No new severity, no schema change.
The dead 4th value `INFO` (client-only, `tokens.ts`) stays unused.

## Counting rules

- **Open finding** = `findings.dismissedAt IS NULL`. `acceptedAt` does not
  exclude a finding — accepted ≠ resolved.
- **Which runs count**: by construction, a `reviews` row is only ever inserted
  on the success path of `ReviewRunExecutor.executeRuns` (see
  `run-executor.ts`), immediately before `completeAgentRun(runId, {status:
  'done', ...})`. A failed/cancelled run never produces a `reviews` row. So
  joining through `reviews` already scopes to completed runs — **no separate
  join to `agent_runs.status` is needed**. (Earlier draft of this spec assumed
  such a join was required; verified against `run-executor.ts` and dropped.)
- **PR-level aggregate**: sum of open findings by severity across **all**
  reviews for that PR (`reviews.kind = 'review'`), not just the latest run.

## API change

`PrMeta` (`src/vendor/shared/contracts/platform.ts`) gains:

```ts
findings: z.object({
  CRITICAL: z.number().int(),
  WARNING: z.number().int(),
  SUGGESTION: z.number().int(),
}).nullish(),
```

Key casing matches the existing (currently unused) client-side scaffold type
`PrRowView.findings` in `client/src/lib/types.ts`.

This same contract file is vendored identically into both `server/src/vendor/
shared` and `client/src/vendor/shared` (no build-time sync step exists in this
repo) — **both copies must be edited together**.

## Query

`GET /repos/:id/pulls` (`src/modules/pulls/routes.ts`) — add one more read-time
aggregate next to the existing score/cost lookups (same file, same "one
IN-query + JS grouping" pattern, no new tables/columns/migrations):

```ts
const findingRows = await container.db
  .select({ prId: t.reviews.prId, severity: t.findings.severity })
  .from(t.findings)
  .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
  .where(and(
    inArray(t.reviews.prId, prIds),
    eq(t.reviews.kind, 'review'),
    isNull(t.findings.dismissedAt),
  ));
```
grouped in JS into `Map<prId, {CRITICAL, WARNING, SUGGESTION}>`, defaulting to
all-zero for PRs with no rows.

## Run-level breakdown (Agent runs tab) — no backend change

`ReviewDto`/`ReviewRecord` (`src/modules/reviews/helpers.ts`,
`src/vendor/shared/contracts/review-api.ts`) already carries `run_id` and each
`FindingRecord` already carries `severity` + `dismissed_at`. `GET
/pulls/:id/reviews` is already fetched by the PR detail page. The per-run
severity counts + full finding list for the Agent-runs popover are derived
**entirely client-side** by joining `RunSummary.run_id` against
`ReviewDto.run_id` — see `client/specs/findings-counter.md`. No new endpoint,
no change to `RunSummary`/`agent_runs`.

## Explicitly not doing

- No denormalized `critical_count`/`warning_count`/`suggestion_count` columns
  on `agent_runs`. A prior branch tried this (leftover columns noted in
  `server/insights.md`, since reverted) — read-time aggregation is simpler
  here and avoids keeping counters in sync on accept/dismiss.
- No DB migration.
