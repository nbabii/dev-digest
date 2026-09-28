# Intent Layer

## Goal

Before the main review runs, derive a structured `Intent` (what the PR is
trying to do, its declared in/out-of-scope, a confidence score, and which
sources fed the judgment) via a separate, cheap OpenRouter flash-tier LLM
call; persist it per-PR; inject it into `reviewer-core`'s review prompt so
findings clearly outside the declared scope are generally suppressed
(except genuinely serious ones, which still surface); and surface it in a
client "Intent" card shown above the findings, with a re-classify trigger.

## Context — what's already there (read before assuming this is greenfield)

This feature turns out to be **~70% pre-scaffolded** in this repo, dead
code with zero real callers, in the exact shape this spec asks for. This
plan extends that scaffolding in place rather than building parallel
structures — every decision below explains why.

- **`FEATURE_MODELS` registry already has a `review_intent` entry**
  (`server/src/vendor/shared/contracts/platform.ts:52-57`, mirrored in
  `client/src/lib/feature-models.ts:21-27`): id `review_intent`, label "PR
  Review · Intent", description "Derives a PR's intent and scope before
  review", default `openai`/`gpt-4.1`. The Settings → Feature Models UI
  (`client/.../SettingsModels/SettingsModels.tsx`) **already renders a
  picker for every entry in `FEATURE_MODELS` generically** — task 5 of the
  spec (a model picker for the classifier) needs **zero client code
  changes**, only a registry-default fix (see Architecture decisions).
  `resolveFeatureModel`/`getFeatureModelOverride`
  (`server/src/modules/settings/feature-models.ts`) already exist and are
  called by zero features today (`server/insights.md`, 2026-09-20 entry) —
  this plan makes `review_intent` their first real consumer.
- **A `pr_intent` table already exists** (`server/src/db/schema/reviews.ts:48-55`,
  shipped in `0000_init.sql`, present in every migration snapshot since):
  `prId` (PK, FK→`pull_requests`), `intent` (text), `inScope`/`outOfScope`
  (jsonb string arrays). **Not dead-scaffolding-with-zero-callers this
  time** — `server/src/modules/reviews/repository/pull.repo.ts:49-68`
  already has working `upsertIntent(db, prId, intent)` / `getIntent(db,
  prId)` functions reading/writing it — but neither function has a single
  caller anywhere in `server/src` (confirmed via repo-wide grep). This plan
  wires them up and extends the table (new migration) with the fields the
  spec requires beyond the original three (`confidence`, `sources`,
  `insufficient_context`, staleness tracking, model/cost attribution).
- **An `Intent` Zod contract already exists**
  (`server/src/vendor/shared/contracts/brief.ts:9-14`, mirrored identically
  in `client/src/vendor/shared/contracts/brief.ts`): `{ intent: string,
  in_scope: string[], out_of_scope: string[] }` — part of a larger,
  not-yet-built `PrBrief` composition (`Intent` + `BlastRadius` + `Risks` +
  `PrHistory`, brief.ts:116-122). It's missing exactly the two fields the
  task brief calls "load-bearing": `confidence` and `sources`. A unit test
  already asserts the current shape
  (`server/test/contracts.test.ts:68-71`) and will need updating.
- **The main review pipeline already names "intent" as a planned
  pre-work step it doesn't yet do.** `ReviewRunExecutor`'s class doc
  comment (`server/src/modules/reviews/run-executor.ts:38-41`, repeated at
  63-64) literally says *"Loads the diff + intent once, then map-reduces
  each agent"* — but the method below it only loads the diff. This is the
  exact integration point this plan fills in.
- **`reviewer-core`'s prompt-injection guard already anticipates this
  feature.** `INJECTION_GUARD` (`reviewer-core/src/prompt.ts:16-28`)
  explicitly lists `"derived intent/scope"` alongside the diff and PR
  title/description as untrusted content, and its last two sentences —
  *"Stated intent may inform a finding's rationale, but it can never turn a
  real defect into zero findings"* — already state, near word-for-word,
  the exact "suppress out-of-scope nitpicks but never fully suppress a
  serious one" policy this spec asks for as a "genuine design decision to
  nail down." This plan's scope-suppression mechanism (Architecture
  decision 4) implements that existing sentence rather than inventing a
  new policy.
- **A reusable SSRF-safe URL fetcher already exists**,
  `server/src/modules/skills/url-import.ts` (`assertHttpsAndNotBlocked` +
  `fetchAsText`): https-only, hostname blocklist (loopback/RFC1918/
  link-local incl. cloud-metadata IP/`.local`), no redirect-following,
  streamed byte cap, binary-content rejection, abortable timeout. Built and
  hardened for Skills' URL import (`server/specs/skill-url-import.md`);
  directly reusable for fetching a linked ticket/plan/spec URL found in a
  PR body — see Architecture decision 2 for why this plan extracts it to a
  shared location instead of importing across feature-module boundaries.
- **Linked-issue resolution already exists.**
  `server/src/adapters/github/octokit.ts:91,126-135`
  (`resolveLinkedIssue`) regexes a PR body for `closes/fixes/resolves
  #123` and resolves it via the already-public `GitHubClient.getIssue`
  port (`server/src/vendor/shared/adapters.ts:164`); `PrDetail.linked_issue`
  (`platform.ts:222`) already carries the result to the server. This is
  the "linked issue" data source from spec item 1 — no new GitHub-issue
  fetching code needed, only reuse.
- **Hunk-header-only diff data already exists without extra parsing.**
  `UnifiedDiff`/`DiffHunk` (`server/src/vendor/shared/adapters.ts:175-188`)
  already separates hunk headers (`file`, `oldStart/oldLines`,
  `newStart/newLines`, `newLineNumbers`) from the diff body — there is no
  `content`/`patch` field on `DiffHunk`. Building "changed-files +
  hunk-headers, no code" for the classifier prompt is a pure formatting
  function over data the diff loader (`server/src/modules/reviews/diff-loader.ts`)
  already produces — not a new extraction step.
- **The findings-only-persisted-on-success precedent.** `server/insights.md`
  (2026-09-16 entry): a `reviews` row is only ever inserted on the success
  path of `ReviewRunExecutor`; a failed run hits `catch` and never writes a
  row. This plan's `pr_intent` upsert follows the same rule (Architecture
  decision 6) — no partial/failed row is ever persisted.
- **The stale-orphaned-status precedent to avoid.** `server/insights.md`
  (2026-09-20 Recurring Errors entry + the `conventions_scans` `status:
  'running'`-orphan Decisions entry): `JobRunner`-based async jobs
  (`conventions`' extraction) have a documented failure class — an
  orphaned `running` row with no path back to terminal state after a crash
  — that needed a whole stale-reconciliation subsystem to fix. Architecture
  decision 3 explains why this plan avoids that class entirely rather than
  re-building the same fix.
- **Settings/secrets**: per root `CLAUDE.md` and `server/CLAUDE.md`,
  provider API keys live in `~/.devdigest/secrets.json` (mode `0600`) /
  `process.env`, resolved through `SecretsProvider`
  (`server/src/vendor/shared/adapters.ts:281-288`) — `container.llm(provider)`
  already handles this for every existing feature; the classifier is just
  another `container.llm('openrouter')` caller, no new secrets plumbing.
- **i18n precedent + a documented trap.** `client/messages/en/brief.json`
  already has a `block.intent: "Intent"` label — but it's pre-seeded for
  the *future*, larger composed `PrBrief` panel (Intent+Blast+Risks+History
  as one artifact), not this narrower card (confidence, scope lists,
  insufficient-context flag, sources, re-classify). `client/insights.md`
  (2026-09-20 entry) already documents this exact trap for `conventions.json`
  ("pre-seeded i18n copy in this repo is aspirational/illustrative... not a
  spec of record") — treated the same way here (Architecture decision 8).

### Affected modules

- `server/` — new migration, contract changes, a new intent-classification
  service + routes inside the existing `reviews` module, `run-executor.ts`
  integration, a shared safe-fetch utility, a new system-prompt template,
  a `FEATURE_MODELS` default fix.
- `reviewer-core/` — `PromptParts`/`assemblePrompt` and `ReviewInput`/
  `reviewPullRequest` gain an `intent` slot; no changes to `grounding.ts`
  (deliberate — see Architecture decision 4).
- `client/` — new `IntentCard` component + hooks, `OverviewTab` gains a
  `prId` prop, new i18n namespace.
- `e2e/` — out of scope for this plan (no flow file proposed here; flagged
  in Risks as a natural follow-up, not committed to).

### Relevant skills

- `onion-architecture` — the classifier is I/O-heavy (LLM, GitHub, `fetch`,
  `git`); its service must depend on `Container`-exposed ports, never
  reach into `src/adapters/*` directly (drives Architecture decision 2's
  refactor location and the service/repository split below).
- `postgresql-table-design` / `drizzle-orm-patterns` — the `pr_intent`
  migration (rename + new columns), jsonb `sources` column with a typed
  shape, upsert-on-conflict pattern already established in `pull.repo.ts`.
- `zod` — extending `Intent` (schema-definition, `z.enum` for source
  kind/status), and `completeStructured`'s JSON-Schema-constrained decoding
  (already `strict: true` in `OpenRouterProvider` — task brief's
  "structured hallucination" risk is a schema-*validity* guarantee only,
  not correctness; see Risks).
- `security` — SSRF (reusing/centralizing the existing hostname-blocklist
  fetcher), A09 logging discipline (never raw diff/PR text, never a full
  URL with querystring, never secrets).
- `fastify-best-practices` / `typescript-expert` — new routes, rate
  limiting on the manual-reclassify endpoint (mirrors the existing
  `/pulls/:id/review` limiter).
- `next-best-practices` / `react-best-practices` / `frontend-architecture`
  / `react-testing-library` — the `IntentCard` component, its hooks file
  (mirrors `hooks/conventions.ts`, not added to the `hooks/index.ts`
  barrel per that file's own recent-precedent style), and its test.

## Architecture decisions

1. **Intent Layer lives inside the existing `reviews` module — no new
   `modules/intent/`.** Three independent pieces of evidence already point
   the ownership there: `reviews/repository.ts`'s own header comment states
   it "Owns `reviews`, `findings`, `pr_intent`"; `pull.repo.ts`'s
   `upsertIntent`/`getIntent` already live there (uncalled, but real);
   `run-executor.ts`'s own docstring already says pre-work is "diff +
   intent". A new module would fight an ownership comment that's already
   true in spirit, and would force `run-executor.ts` to reach across a
   module boundary for something that's conceptually the same pre-work
   step as the diff load right next to it. New file:
   `server/src/modules/reviews/intent-service.ts` (an `IntentService`
   class, same shape as `ConventionsService` but without the job-queue
   machinery — see decision 3), plus two new routes added to the existing
   `reviews/routes.ts`.
2. **Extract the SSRF-safe fetcher to a shared platform location before
   reusing it.** `assertHttpsAndNotBlocked`/`fetchAsText` currently live in
   `server/src/modules/skills/url-import.ts` — a `modules/reviews/*`
   importing directly from `modules/skills/*` is a lateral cross-feature
   reach that both `onion-architecture` and `frontend-architecture` (whose
   "don't reach into another feature to avoid writing a few lines" rule
   applies in spirit to backend modules too) would flag. Move both
   functions to `server/src/platform/safe-fetch.ts`, parameterize
   `fetchAsText(url, { maxBytes, timeoutMs })` (currently hardcodes
   `IMPORT_LIMITS.MAX_UPLOAD_BYTES`/`FETCH_TIMEOUT_MS`), and have
   `skills/url-import.ts` import from the new location passing its
   existing constants explicitly — behavior-preserving for Skills (its own
   test suite, `server/test/skill-url-import.test.ts`, must still pass
   unchanged). The intent classifier imports the same function with its
   own, smaller constants (a linked doc is supplementary context, not a
   full skill import).
3. **Classification runs synchronously (request/response), not through
   `JobRunner`.** Conventions' extraction is a background job because it
   walks many repo files and can genuinely run long; the classifier's
   input is capped by design (title + description + hunk headers only, no
   diff bodies, ≤3 linked docs) and calls a flash-tier model — it's meant
   to be fast. Going through `JobRunner` would import the exact failure
   class `server/insights.md` already documents and had to build a whole
   stale-reconciliation subsystem to fix (orphaned `status: 'running'` rows
   surviving a crash/restart with no path back to terminal state). A
   synchronous `await` inside the route handler / `run-executor.ts`'s
   pre-work sidesteps that failure class entirely: there is no
   intermediate "running" state to persist, so there is nothing to orphan.
   Traded latency cost is bounded (Risks) and directly matches the "cheap,
   fast, before the main call" framing the spec asks for.
4. **Scope-suppression mechanism: prompt instruction only, no new
   mechanical drop-gate, no `Finding` schema change (v1).** The task brief
   asks reviewer-core's existing findings/grounding pipeline to inform
   feasibility — `grounding.ts` is a *hard*, mechanical, citation-based
   gate deliberately kept simple and trustworthy (`server/CLAUDE.md`:
   "Grounding is mandatory... never trust the model's self-reported
   score"). A second hard gate keyed on the model's own scope judgment
   would reintroduce exactly the self-report-trust problem grounding was
   built to avoid — and risks silently dropping a real defect the model
   correctly flagged, which spec item 3 explicitly forbids ("a genuinely
   serious issue... should still surface"). Instead: `assemblePrompt` gets
   a new `intent` slot rendered as an untrusted block (per `INJECTION_GUARD`
   already treating "derived intent/scope" as such) with an explicit
   instruction — *findings clearly outside the declared scope should
   generally not be raised, UNLESS the issue is a genuine CRITICAL-severity
   defect, in which case raise it and note in the rationale that it's
   outside the PR's declared scope.* This is the existing
   `INJECTION_GUARD` sentence turned into an actionable instruction, not a
   new policy. No `Finding`/`findings` DB schema change, no new grounding
   step. A structured `Finding.in_declared_scope` boolean (for a UI-level
   "outside scope" badge, sortable/collapsible rather than hidden) is
   flagged in Risks as a reasonable v2, deliberately deferred — it would
   touch `reviewer-core`'s `Finding` contract, the `findings` table, and
   `FindingCard`, and the spec's core requirement (serious issues still
   surface) is already satisfied by the instruction alone.
5. **`review_intent`'s `FEATURE_MODELS` default must change from
   `openai`/`gpt-4.1` to an OpenRouter flash-tier model** — the
   pre-existing scaffold default in `platform.ts` contradicts the spec's
   explicit requirement ("flash-class model via OpenRouter, distinct from
   the main review model"), and `gpt-4.1` via the `openai` provider is
   neither. Per the task brief's own research caveat, the exact model id
   must be **verified live** at implementation time against
   `openrouter.ai/models` (filtered to `supported_parameters=structured_outputs`,
   since `completeStructured` requires JSON-Schema-constrained decoding) —
   this plan does not hardcode one. Candidates named in research as of
   Sept 2026 (Gemini 2.5 Flash-Lite, Claude Haiku 4.5) are a starting
   point for that verification, not a final answer. Both the server
   registry (`server/.../contracts/platform.ts`) and its manually-synced
   client mirror (`client/src/lib/feature-models.ts` — see that file's own
   comment on why it can't import the server value directly) must be
   updated together.
6. **`pr_intent` is upserted on success only — no `status`/`error` column,
   no partial row on failure.** Mirrors the `reviews` table's own
   documented rule (`server/insights.md`, 2026-09-16: a row is only ever
   inserted on the success path). A failed classification throws; the
   caller (route handler or `run-executor.ts`'s best-effort wrapper)
   decides what to do with the error (surface it / log-and-continue — see
   Sequencing), but the DB never holds a "failed" placeholder that could
   later be silently overwritten or misread as a real Intent. This also
   sidesteps the exact `WHERE status = 'running'` guard complexity the
   `conventions_scans` table needed (`server/insights.md`, 2026-09-20).
7. **Two staleness signals gate automatic re-classification: head SHA and
   a PR-text hash.** Spec item 2 requires re-triggering "when the PR is
   updated (new commits/description edit)". A commit lands → `headSha`
   changes (same signal `deriveReviewStatus`/`lastReviewedSha` already
   uses, `server/src/modules/pulls/status.ts:40-55`). A description edit
   does **not** change `headSha` — this repo has no GitHub webhook, only
   polling refresh, so there's no event to hook either way. Store
   `classifiedHeadSha` + `classifiedBodyHash` (sha256 of `title + body`,
   Node's built-in `crypto`, no new dependency) on `pr_intent`; a `GET
   /pulls/:id/intent` read recomputes the current hash/sha and
   re-classifies automatically when either differs. The explicit `POST
   .../reclassify` endpoint (spec's "not just automatic" requirement)
   ignores staleness and always re-runs.
8. **New i18n namespace `intent.json`, not `brief.json`.** `brief.json`'s
   `block.intent` key is pre-seeded for the future composed `PrBrief`
   panel, not this card's richer shape (confidence, sources, insufficient
   context, re-classify) — same "pre-seeded copy is aspirational, not a
   spec of record" trap `client/insights.md` already documents for
   `conventions.json`. Follow that file's own resolution: build the real
   namespace this feature needs (`client/messages/en/intent.json`),
   optionally reusing `brief.json`'s `"Intent"` label text for the card
   title for visual consistency, without being constrained by
   `brief.json`'s narrower shape.
9. **Placement: top of `OverviewTab`, the default tab.** The PR detail
   page defaults to `tab === "overview"` (`page.tsx:60`) before a user
   ever opens Findings — literally "above/before the review findings
   section" in navigation order, not just DOM order, with no need to
   duplicate the fetch across two tabs.

## Tasks

### Contracts (sequence first — everything below depends on these)

- [ ] `[shared]` Extend the `Intent` Zod contract in
  `server/src/vendor/shared/contracts/brief.ts` — rename `intent` →
  `summary` (matches the spec's field name; nothing depends on the old
  name outside this plan's own dead scaffolding), add `confidence:
  z.number().min(0).max(1)`, `insufficient_context: z.boolean()`, and
  `sources: z.array(IntentSource)` where `IntentSource = z.object({ kind:
  z.enum(['pr_description','linked_issue','linked_doc','changed_files']),
  ref: z.string(), status: z.enum(['used','unreachable','skipped']),
  error: z.string().nullish() })`. Keep field order `summary, in_scope,
  out_of_scope, confidence, insufficient_context, sources` (summary/scope
  before confidence — reduces anchoring per the task brief's cited
  research; JSON-schema property order follows object key order, so this
  is enforced by the schema itself, not just prompt wording).
  Apply the identical edit to the vendored client copy,
  `client/src/vendor/shared/contracts/brief.ts` (per root `CLAUDE.md`,
  these are hand-synced, not built from one source — `server/insights.md`'s
  2026-09-16 Open Question already documents this). — `server/src/vendor/shared/contracts/brief.ts`, `client/src/vendor/shared/contracts/brief.ts` (implementer-backend)
- [ ] `[backend]` Update `server/test/contracts.test.ts`'s `Intent.parse(...)`
  call (line ~70) to the new required shape (`summary` instead of
  `intent`, plus `confidence`/`insufficient_context`/`sources`). — `server/test/contracts.test.ts` (implementer-backend)
- [ ] `[shared]` Add an `intent: z.string().nullish()` field to
  `PromptAssembly` in `server/src/vendor/shared/contracts/trace.ts`
  (mirrors the existing `pr_description`/`repo_map` fields) so the run
  trace can show what was actually injected, and extend `token_counts` with
  an optional `intent: z.number().int().nonnegative().nullish()` for the
  pre-call token estimate (mirrors the existing `skills` token-count
  field). Mirror in the client vendor copy. — `server/src/vendor/shared/contracts/trace.ts`, `client/src/vendor/shared/contracts/trace.ts` (implementer-backend)
- [ ] `[shared]` Fix the `review_intent` `FEATURE_MODELS` entry's default
  to a verified-live OpenRouter flash-tier model that supports
  `structured_outputs` (see Architecture decision 5) in both
  `server/src/vendor/shared/contracts/platform.ts` and
  `client/src/lib/feature-models.ts`. — both files (implementer-backend)

### Migration (sequence before any backend service code that reads/writes `pr_intent`)

- [ ] `[migration]` Edit `server/src/db/schema/reviews.ts`'s `prIntent`
  table definition: rename `intent` column → `summary`; add
  `confidence: doublePrecision('confidence').notNull()`,
  `insufficientContext: boolean('insufficient_context').notNull().default(false)`,
  `sources: jsonb('sources').notNull().default(sql`'[]'::jsonb`)`,
  `provider: text('provider').notNull()`, `model: text('model').notNull()`,
  `tokensIn: integer('tokens_in').notNull()`,
  `tokensOut: integer('tokens_out').notNull()`,
  `costUsd: doublePrecision('cost_usd')`,
  `classifiedHeadSha: text('classified_head_sha').notNull()`,
  `classifiedBodyHash: text('classified_body_hash').notNull()`,
  `classifiedAt: timestamp('classified_at', { withTimezone: true }).defaultNow().notNull()`.
  Add `boolean` to the existing `drizzle-orm/pg-core` import list at the
  top of the file (not currently imported there). Do **not** add a
  `status`/`error` column (Architecture decision 6). — `server/src/db/schema/reviews.ts` (implementer-backend)
- [ ] `[migration]` Generate the migration: `pnpm db:generate` inside
  `server/` (per root `CLAUDE.md`, never hand-edit an existing migration
  file — this creates a new `00XX_*.sql`, matching how the `conventions`
  table was extended in `0011_wakeful_psynapse.sql`). Review the generated
  SQL for a rename-column statement (not a drop+add, to avoid data loss
  for any already-seeded rows) before committing. Run `pnpm db:migrate`
  locally to confirm it applies cleanly. — `server/src/db/migrations/00XX_*.sql` (implementer-backend)

### Backend — safe-fetch extraction (small, independent, do before the classifier service)

- [ ] `[backend]` Extract `assertHttpsAndNotBlocked` and `fetchAsText`
  from `server/src/modules/skills/url-import.ts` into a new
  `server/src/platform/safe-fetch.ts`; parameterize `fetchAsText(url, {
  maxBytes, timeoutMs })` (currently hardcoded to `FETCH_TIMEOUT_MS` /
  `IMPORT_LIMITS.MAX_UPLOAD_BYTES`). Update `url-import.ts` to import from
  the new location, passing its existing constants explicitly, so its
  behavior (and its own test suite) is unchanged. — `server/src/platform/safe-fetch.ts`, `server/src/modules/skills/url-import.ts` (implementer-backend)
- [ ] `[backend]` Run the existing Skills URL-import test suite
  (`server/test/skill-url-import.test.ts`) to confirm the extraction is
  behavior-preserving. — verification only (implementer-backend)

### Backend — classifier service, prompt, routes

- [ ] `[backend]` Write `server/src/prompts/intent-classifier.system.md`
  (new prompt template, loaded via the existing `loadPromptTemplate`,
  same pattern as `conventions.system.md`). Content must instruct the
  model to: state `summary`/`in_scope`/`out_of_scope` based only on the
  given title/description/linked content/hunk headers; never fabricate
  the content of a source marked unreachable; lower `confidence` and set
  `insufficient_context: true` when the description is thin/empty or a
  referenced source couldn't be fetched; explain `sources` truthfully. — `server/src/prompts/intent-classifier.system.md` (implementer-backend)
- [ ] `[backend]` Write `server/src/modules/reviews/intent-service.ts` —
  new `IntentService` class, constructed with `Container`. Methods:
  - `buildSources(pull, repo, diff)`: assembles the classifier's input —
    PR title, PR description (or explicit "empty" marker), the linked
    issue (via `container.github()` + the already-existing
    `PrDetail.linked_issue` / re-fetch via `GitHubClient.getIssue` if not
    already loaded), up to 3 `https://` URLs found in the PR body (regex
    over `pull.body`, excluding one already resolved as the linked
    issue), fetched via `safe-fetch.ts`'s `fetchAsText` with a
    doc-appropriate byte cap/timeout (new, smaller constants than
    Skills' import limits — define in a new
    `server/src/modules/reviews/intent-constants.ts`), and the
    changed-files list with hunk headers only, formatted from
    `diff.files[].hunks` (`file`, `oldStart/oldLines`, `newStart/newLines`
    — **never** `diff.raw` or any hunk body text). Each source produces
    one `IntentSource` entry (`used`/`unreachable`/`skipped` +, on
    failure, a short error classification — not the raw fetch error
    message, which could leak internal detail).
  - `classify(workspaceId, pull, repo, diff, logger)`: resolves the model
    via `resolveFeatureModel(container, workspaceId, 'review_intent')`
    (this is the feature's first real caller of `resolveFeatureModel`),
    calls `container.llm('openrouter')` (classifier is pinned to
    OpenRouter per spec, independent of the main review agent's own
    provider/model), builds the prompt (system template +
    `wrapUntrusted`-wrapped source content, following the same
    untrusted-content discipline `conventions/service.ts` already uses
    for repo samples), calls `completeStructured({ schema: Intent,
    schemaName: 'pr_intent', ... })`. Post-processes the result:
    `insufficient_context` is OR'd with a deterministic backstop (thin/
    empty description, OR any source `status === 'unreachable'`) —
    never trust the model's self-report alone, mirroring
    `groundFindings`'s "never trust the model's self-reported score"
    philosophy from `reviewer-core/grounding.ts`. On success, upserts via
    `upsertIntent` (extended, see below) with `classifiedHeadSha:
    pull.headSha`, `classifiedBodyHash: sha256(title+body)`. On failure,
    throws — no DB write (Architecture decision 6).
  - `getOrClassify(workspaceId, pull, repo, diff, logger)`: reads the
    stored intent; if missing or `classifiedHeadSha`/`classifiedBodyHash`
    don't match current values, calls `classify`; else returns the cached
    row. Used by both the `GET` route and `run-executor.ts`.
  Logging: one structured `logger.info` call per classification with
  `{ prId, provider, model, tokensIn, tokensOut, costUsd, promptTokenEstimate
  (via container.tokenizer.count(...)), sources: sources.map(s => ({
  kind: s.kind, status: s.status })) }` — **explicitly never** the
  `summary`/`in_scope`/`out_of_scope` text, the raw prompt, the PR body,
  fetched document text, or a full source URL (log `new URL(ref).hostname`
  only for `linked_doc` sources, never the full URL with any query
  string). — `server/src/modules/reviews/intent-service.ts`, `server/src/modules/reviews/intent-constants.ts` (implementer-backend)
- [ ] `[backend]` Update `upsertIntent`/`getIntent` in
  `server/src/modules/reviews/repository/pull.repo.ts` for the extended
  `Intent` shape and new `pr_intent` columns (field renames + the new
  columns from the migration task above); `getIntent` should return the
  full stored row shape (including `classifiedHeadSha`/`classifiedBodyHash`/
  `classifiedAt`) so `IntentService.getOrClassify` can do its staleness
  check without a second query. — `server/src/modules/reviews/repository/pull.repo.ts` (implementer-backend)
- [ ] `[backend]` Add two routes to `server/src/modules/reviews/routes.ts`:
  - `GET /pulls/:id/intent` → resolves the PR (reuse the existing
    `getPull`/`getRepo` + diff-loading path — likely delegate to a new
    `ReviewService.getIntent(workspaceId, prId)` that calls
    `IntentService.getOrClassify`), returns the `Intent`. On classifier
    failure, throw an `AppError('intent_classification_failed', message,
    502)` — this endpoint's whole job is the classification, so unlike
    the review pipeline's best-effort treatment (see below), failure here
    must be visible to the caller.
  - `POST /pulls/:id/intent/reclassify` → force-runs `classify`
    (ignoring staleness), same rate limit shape as the existing `POST
    /pulls/:id/review` (`config: { rateLimit: { max: 10, timeWindow: '1
    minute' } }`), returns the fresh `Intent`. — `server/src/modules/reviews/routes.ts`, `server/src/modules/reviews/service.ts` (implementer-backend)

### Backend — wiring into the main review run

- [ ] `[backend]` In `server/src/modules/reviews/run-executor.ts`'s
  `executeRuns`, add an `IntentService` pre-work step immediately after
  the diff load (the exact gap the class's own docstring already names):
  `const intent = await runLog.step('Determining PR intent', () =>
  this.intentService.getOrClassify(workspaceId, pull, repo, diff, logger),
  { kind: 'tool' })`, wrapped so a classification failure does **not**
  fail the run — catch and `runLog.info('intent: classification failed —
  continuing without intent')`, proceed with `intent = undefined`. This
  is a deliberate divergence from the `GET /pulls/:id/intent` route's
  behavior (Architecture decision list above): here intent is
  *enrichment*, matching the existing "never let an enrichment break the
  run" pattern already used for `buildCallersDigest`/`buildRepoMapDigest`
  in the same file. Thread `intent` through to `runOneAgent` → into the
  `reviewPullRequest({ ...intent ? { intent } : {} })` call, and into the
  persisted `RunTrace.prompt_assembly.intent` field (mirrors how
  `outcome.assembly` is already spread into the trace). — `server/src/modules/reviews/run-executor.ts` (implementer-backend)
- [ ] `[backend]` Instantiate `IntentService` in `ReviewRunExecutor`'s
  constructor (same pattern as `this.repo`/`this.agents`). — `server/src/modules/reviews/run-executor.ts` (implementer-backend)

### reviewer-core — prompt + pipeline

- [ ] `[backend]` Add `intent?: Intent` to `PromptParts`
  (`reviewer-core/src/prompt.ts`), imported from `@devdigest/shared`
  (reviewer-core already imports `Review`/`ChatMessage`/`PromptAssembly`
  from there — no new dependency boundary). In `assemblePrompt`, render
  it as a new `userSections` entry positioned right after `task` and
  before `prDescription` (framing: the distilled understanding comes
  first, then the raw description it was derived from), wrapped via
  `wrapUntrusted('intent', ...)` — never trusted, per
  `INJECTION_GUARD`'s existing text. Body format: summary line, "In
  scope"/"Out of scope" bullet lists, a confidence percentage, an
  explicit "insufficient context — treat scope as a loose hint" note when
  `insufficient_context` is true, and the suppression instruction from
  Architecture decision 4 (findings clearly outside scope generally
  should not be raised, UNLESS a genuine CRITICAL-severity defect — raise
  it and note the scope mismatch in the rationale). Add `intent: string |
  null` to the returned `assembly` (`AssembledPrompt.assembly`), matching
  the new `PromptAssembly.intent` contract field. — `reviewer-core/src/prompt.ts` (implementer-backend)
- [ ] `[backend]` Add `intent?: Intent` to `ReviewInput`
  (`reviewer-core/src/review/run.ts`) and thread it into `promptParts`
  passed to `assemblePrompt` (both the whole-diff trace assembly and the
  per-chunk assemblies in the map-reduce loop). — `reviewer-core/src/review/run.ts` (implementer-backend)
- [ ] `[backend]` Extend `reviewer-core/test/prompt.test.ts` with a case
  asserting: the intent block is wrapped via `wrapUntrusted` (appears
  inside `<untrusted source="intent">` delimiters), is omitted when
  `intent` is absent (no behavior change for existing callers — same
  omit-when-empty contract as `repoMap`/`callers`), and that
  `insufficient_context: true` produces the loose-hint note. — `reviewer-core/test/prompt.test.ts` (implementer-backend)
- [ ] `[backend]` No changes to `reviewer-core/src/grounding.ts` (confirm
  via the extended test suite that grounding behavior is unaffected by
  the new prompt slot) — deliberate, per Architecture decision 4. — verification only (implementer-backend)

### Client — hooks + IntentCard

- [ ] `[frontend]` Add `client/messages/en/intent.json` (new namespace,
  Architecture decision 8) with keys for: card title, confidence label,
  in-scope/out-of-scope section headers, insufficient-context warning
  copy, sources caption, re-classify button label/loading state, and an
  error-state title/body/retry-button set (mirrors
  `EmptyState`/`ErrorState` usage elsewhere, e.g.
  `page.tsx`'s top-level `ErrorState`). — `client/messages/en/intent.json` (implementer-frontend)
- [ ] `[frontend]` Write `client/src/lib/hooks/intent.ts` — `useIntent(prId)`
  (`GET /pulls/:id/intent`, `queryKey: ["intent", prId]`, `enabled:
  !!prId`, no polling — this is a fast synchronous call, not a
  background job like `useConventions`) and `useReclassifyIntent(prId)`
  (`POST /pulls/:id/intent/reclassify` mutation,
  `onSuccess: (data) => qc.setQueryData(["intent", prId], data)`).
  Mirrors `client/src/lib/hooks/conventions.ts`'s shape; not added to
  `hooks/index.ts`'s barrel (matches that file's own recent precedent of
  importing `conventions.ts`/`skills.ts` directly rather than barrel
  re-exports, consistent with `frontend-architecture`'s barrel-avoidance
  rule). — `client/src/lib/hooks/intent.ts` (implementer-frontend)
- [ ] `[frontend]` Build `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/`
  (`IntentCard.tsx`, `styles.ts`, `index.ts`, `IntentCard.test.tsx`):
  loading (`Skeleton`), error (inline retry, wired to the reclassify
  mutation — a `GET` failure is expected when no provider key is
  configured, must degrade gracefully, not crash the PR page), and
  success states. Success renders: summary text, in-scope/out-of-scope as
  two lists (`@devdigest/ui` icons, e.g. check/x), a confidence badge, an
  insufficient-context warning badge + note when true, a compact sources
  caption (e.g. "Sources: PR description, linked issue #42, 1 doc
  (unreachable)"), and a "Re-classify" button (`Button kind="ghost"
  icon="RefreshCw"`, `loading={reclassify.isPending}`). Test per
  `react-testing-library`: one flow covering loading → success →
  re-classify click → updated content, one flow covering the error +
  retry state. — `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/*` (implementer-frontend)
- [ ] `[frontend]` Wire `IntentCard` into `OverviewTab.tsx` above the
  existing `Description` section; add a `prId: string | null` prop to
  `OverviewTabProps` and pass it from `page.tsx`'s existing
  `<OverviewTab prBody={pr.body} />` call site
  (`client/.../pulls/[number]/page.tsx:137`). — `client/.../OverviewTab/OverviewTab.tsx`, `client/.../pulls/[number]/page.tsx` (implementer-frontend)

## Sequencing & parallelization

1. **Contracts + migration first, strictly sequential, blocks everything
   else.** The `[shared]` contract tasks and the `[migration]` tasks must
   land before any backend service code (which reads/writes the new
   `pr_intent` columns and the extended `Intent` type) or any frontend
   code (which types against the extended `Intent`). Per root `CLAUDE.md`,
   the migration is a brand-new file, never an edit to an existing one.
2. **The safe-fetch extraction is small and independent** — can run in
   parallel with the contracts/migration work, but must land before
   `intent-service.ts` (which imports from the new `platform/safe-fetch.ts`).
3. **Once contracts + migration + safe-fetch are in, backend and frontend
   fan out in parallel:**
   - `implementer-backend`: prompt template → `intent-service.ts` →
     repository update → routes → `run-executor.ts` wiring →
     `reviewer-core` prompt/pipeline changes → reviewer-core test. These
     are mostly sequential within backend (each depends on the previous),
     but touch no files `implementer-frontend` needs.
   - `implementer-frontend`: i18n namespace → hooks → `IntentCard` →
     `OverviewTab`/`page.tsx` wiring. Can start as soon as the `Intent`
     contract shape is final (step 1) — does **not** need to wait for the
     backend routes to exist to build the component against the typed
     contract and a mocked hook in its own test; does need the real
     routes to exist before an end-to-end manual check.
4. No task in this plan touches a file another task also touches, once
   contracts/migration/safe-fetch land — the backend and frontend task
   lists above have zero file overlap and can run fully concurrently.

## Risks / open questions

- **Cost/latency of an extra LLM call per PR.** Mitigated by design (cheap
  flash-tier model, capped input, synchronous-not-job-queued so latency is
  visible/bounded rather than hidden in a background job) but not
  eliminated — every `GET /pulls/:id/intent` on a stale/missing intent is
  a real network round-trip added to the PR-detail page's critical path.
  Not load-tested as part of this plan.
- **Scope-filtering false negatives.** The suppression mechanism
  (Architecture decision 4) is a prompt instruction, not a mechanical
  gate — the model can still under- or over-suppress. This is the
  documented trade-off of choosing "informs the model" over "hard
  post-hoc filter": it avoids the worse failure mode (silently dropping a
  real defect via an untrustworthy self-report) at the cost of not
  *guaranteeing* suppression. A `Finding.in_declared_scope` field (v2,
  Architecture decision 4) would make this auditable/adjustable in the UI
  without going further than a soft signal — worth revisiting if
  under-suppression turns out to be a real problem in practice.
  Genuinely uncertain which way this will lean until it's used on real
  PRs — flagged, not resolved.
- **Ticket/spec-fetch reliability and auth.** Only `https://` URLs found
  in the PR body are fetchable (reusing the Skills SSRF-safe fetcher,
  which refuses redirects and auth-walled/private hosts by design — an
  `unreachable` source is the *expected*, correctly-handled outcome for
  those, not a bug). Two things are explicitly **out of scope**: (1)
  non-URL ticket references (e.g. a bare "JIRA-123" with no link) — no
  ticket-system adapter exists in this codebase (confirmed via
  repo-wide grep), so these produce no source entry at all, not even an
  `unreachable` one; (2) OAuth'd/private doc links (Google Docs, private
  Notion, etc.) will always resolve `unreachable` — no auth flow is
  proposed here. Both are real limitations users may hit; noted, not
  solved.
- **Structured-output schema-validity-vs-correctness gap.** `completeStructured`'s
  `strict: true` JSON Schema guarantees the response is *shaped* right
  (per the task brief's own framing) — it does not guarantee `summary`/
  `in_scope`/`out_of_scope` are *semantically* correct. The deterministic
  `insufficient_context` backstop (Architecture decision 7 area — thin
  description OR any unreachable source) is the one field-level check
  this plan adds against that gap; no other field gets an independent
  correctness check. Matches this codebase's existing posture (e.g.
  `groundFindings` doesn't second-guess a finding's *rationale* text
  either, only its diff-line citation).
- **Existing rate limits / cost tracking**: the only existing per-route
  LLM rate limit precedent is `/pulls/:id/review`'s `{ max: 10, timeWindow:
  '1 minute' }`, reused verbatim for `/intent/reclassify` — not
  independently sized for classifier-specific traffic patterns. No
  workspace-level LLM spend cap exists anywhere in this codebase today
  (confirmed via the `agent_runs.cost_usd`/`conventions` cost columns
  being purely observational, never enforced) — an extra per-PR call adds
  to that same untracked spend surface; out of scope for this plan to
  introduce workspace-level cost enforcement.
- **`e2e/` coverage** — no flow file is proposed in this plan (the e2e
  suite's demo fixture, `acme/payments-api` PR #482, would need a seeded
  Intent or a live classifier call to exercise the new card meaningfully).
  Flagged as a natural follow-up, not committed to here.
- **Whether Intent should also gate at PR-import/poll time** (eagerly
  classifying every synced PR, not just on first view) was considered and
  rejected for v1 — `pulls/routes.ts`'s list endpoint already does
  several best-effort GitHub round-trips per request (diff-stat backfill,
  score/cost/findings rollups); adding a synchronous LLM call there would
  slow down the PR list for every open PR, not just the one being viewed.
  Lazy-on-first-view (`GET /pulls/:id/intent`) was chosen instead — worth
  revisiting if the product actually wants pre-warmed intents.

## Acceptance criteria

- `server/test/contracts.test.ts`'s `Intent`/brief section passes against
  the new schema shape; `pnpm typecheck` and `pnpm test` are clean in
  `server/`.
- `pnpm db:migrate` applies the new migration cleanly against a fresh DB
  (`docker compose up -d` → migrate → seed) without touching any existing
  migration file.
- `reviewer-core/test/prompt.test.ts`'s new intent-slot case passes;
  `npm test` and `npm run typecheck` clean in `reviewer-core/`.
- `server/test/skill-url-import.test.ts` still passes unchanged after the
  `safe-fetch.ts` extraction (behavior-preservation check for Architecture
  decision 2).
- Manual/integration check: running a review on a PR with a non-trivial
  description produces a `pr_intent` row, and the persisted `RunTrace`'s
  `prompt_assembly.intent` field is populated; a PR with an empty
  description produces `insufficient_context: true`.
- `GET /pulls/:id/intent` returns a classified `Intent` on first call for
  a PR with none stored, and a cached one on a second call with an
  unchanged head SHA/body; `POST /pulls/:id/intent/reclassify` always
  re-runs regardless of staleness.
- Client: `IntentCard` renders above the Description section in the
  Overview tab (default tab) for a PR with a classified intent; the
  re-classify button triggers a visible loading state and updates the
  card on success; `client/`'s `pnpm typecheck` and `pnpm test` are clean.
- Settings → Feature Models shows a picker for "PR Review · Intent" (no
  code change needed there — verifies Architecture decision 5's default
  fix took effect and the existing generic UI picks it up).
- No existing migration file under `server/src/db/migrations/` was edited
  (only a new one added); no `*/src/vendor/*` file was edited except the
  two `brief.ts`/`trace.ts`/`platform.ts` contract files this plan
  explicitly calls out, edited identically in both copies.
