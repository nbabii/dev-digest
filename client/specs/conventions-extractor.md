# Conventions Extractor — client

A new repo-scoped page (`Conventions in <repo>`) that runs the server's
extraction job, lists candidates with approve/reject, and bundles the
accepted ones into a skill through a review-before-save modal. See
`server/specs/conventions-extractor.md` for the API/data-model side.

## Already anticipated, same as `skills.json` was before that feature

`client/messages/en/conventions.json` already exists with real copy (page
heading, subtitle, empty state, `candidateCount` pluralized string, a card
section with `confidence`/`accepted`/`accepting`/`acceptAsSkill`) and
`client/src/components/app-shell/helpers.ts:31` already special-cases
`pathname.includes("/conventions")` → active nav key `"conventions"`. Neither
a nav entry, a route, nor any component exists yet — same "shape already
seeded, nothing wired up" situation `client/specs/skills.md` described for
`skills.json`.

**One real conflict to flag, not silently resolve**: the seeded copy's card
section (`card.acceptAsSkill: "Accept as Skill"`, no reject key at all)
implies a *per-candidate*, one-click-to-skill flow — each accepted candidate
immediately becomes its own skill. That contradicts the written requirement
("едитувати конкретний інсайт", "перейти на модал едитування скіла **з
інсайтами які я вибрав**" — plural, a batch of selected insights merged into
one skill) and both provided mockups (a shared "3 of 3 accepted" counter +
one "Create skill" button that merges **all accepted candidates in the
current scan** into a single skill draft). This spec follows the explicit
written requirement and the mockups — the batch flow — and treats
`acceptAsSkill` as copy for **toggling a candidate to `accepted`** (its
actual server effect, per `PATCH /conventions/:id`), not for creating a
skill per candidate. New keys are added for what the seeded file doesn't
cover (reject, deselect-all, the accepted-count bar, the create-skill modal)
rather than repurposing `acceptAsSkill` to mean something the button no
longer does.

## Nav + route

`client/src/vendor/ui/nav.ts` — add to the `"SKILLS LAB"` group, after
`skills` (matches both mockups' left-nav order: Skills, Agents, Conventions):

```ts
{ key: "conventions", label: "Conventions", icon: "ListChecks", href: "/repos/:repoId/conventions", gKey: "c" },
```

`ListChecks` is already in the icon allow-list
(`client/src/vendor/ui/icons.tsx:74,158`) — no new icon export needed. Add
`{ keys: "g c", label: "Go to Conventions", group: "Navigation" }` to
`SHORTCUTS`.

New route `client/src/app/repos/[repoId]/conventions/page.tsx` +
`_components/ConventionsView/` — repo-scoped like
`repos/[repoId]/pulls/page.tsx`, not a top-level page like `skills/page.tsx`
(this feature operates on one repo's clone, unlike Skills which is
workspace-global).

## Data hooks

New `client/src/lib/hooks/conventions.ts`, same shape as
`client/src/lib/hooks/skills.ts`:

- `useConventions(repoId, poll)` — `GET /repos/:id/conventions`, same
  boolean-`poll`-flag shape as `useRepoIntelStatus`
  (`client/src/lib/hooks/repo-intel.ts:31-38`, `refetchInterval: poll ? 1500
  : false`). The page passes `poll: scan?.status === 'running'`, i.e. it
  polls itself off once the scan reaches a terminal status — same "caller
  owns when to stop polling" note already written into that hook's doc
  comment.
- `useRunExtraction(repoId)` — `POST /repos/:id/conventions/extract`,
  invalidates `["conventions", repoId]` on success (202 means "started", not
  "done" — the poll above picks up completion).
- `useUpdateConvention(id)` — `PATCH /conventions/:id`, optimistic update on
  `status` toggle (accept/reject should feel instant — the mockup's
  `Accepted`/`Reject` buttons are a binary toggle, not a form submit).

Query key shape: `["conventions", repoId]` for the list,
matching the `["skill", id]` singular/plural convention in
`client/src/lib/hooks/skills.ts`.

## Page — candidate list

`ConventionsView`:

- Header: breadcrumb `Skills Lab > Conventions` (copy already seeded:
  `page.crumbLab`/`page.crumbConventions`), heading `page.headingPrefix +
  repoName` (already seeded), subtitle (already seeded), **Re-scan** button
  (`page.rescan`, already seeded) calling `useRunExtraction`, disabled +
  showing `page.scanning` while `scan.status === 'running'`.
- Meta line: "Detected from N sample files · last scan Xh ago" — **new i18n
  keys** (`page.detectedFrom`, relative-time already has a shared formatter
  elsewhere in the client, reuse it, don't add a second one), sourced from
  `scan.sample_file_count`/`scan.finished_at` (wire fields are snake_case,
  per `server/specs/conventions-extractor.md`'s `ConventionScan` contract).
  Not in the seeded file; add
  alongside the existing `page.*` keys rather than a new namespace.
- Actions bar: **Deselect all** + "`{accepted} of {total} accepted`" +
  **Create skill** button (primary, disabled when `accepted === 0`) — all
  three are **new i18n keys** under `page.*` (the seeded file has
  `candidateCount` for a different string — total candidates, not the
  accepted/total ratio — keep both, they render in different places: the
  mockup doesn't actually show `candidateCount`'s "grounded against sampled
  files" line and the accepted-ratio bar together, but both are useful and
  cheap to keep).
- Empty state: already seeded (`page.empty.*`) — repo has never been
  scanned, or scan found nothing.
- Error state: `page.loadError`/`page.extractionFailed` already seeded — the
  latter renders when `scan.status === 'failed'`, showing `scan.error`.
- Grid/list of `ConventionCard`, one per candidate in the current scan.

### `ConventionCard`

New component, `ConventionsView/_components/ConventionCard/`. Per mockup:

- Title = `rule` (italic, bold, per mockup's `Always use async/await instead
  of .then() chains` styling).
- Evidence block: monospace header `evidence_path:evidence_line_start-
  evidence_line_end` with a copy-path icon button, then `evidence_snippet`
  rendered as a plain code block (no syntax highlighting library exists in
  this client today — checked, matches the `Textarea mono` precedent
  `client/specs/skills.md` already established for skill bodies; don't add
  one for this feature alone).
- Confidence bar: `confidence` is a 0-1 fraction on the wire (matches the
  existing `conventions.confidence` column's `doublePrecision` semantics,
  per `server/specs/conventions-extractor.md` — **not** a 0-100 int), so the
  card does `Math.round(confidence * 100)}%` for display (mockup: "91%",
  "78%", "85%"). Reuse whatever primitive backs a percentage/progress bar
  elsewhere in `@devdigest/ui` (check `client/src/vendor/ui/` before adding
  a new one) — it takes the already-converted 0-100 display value.
- Accept/Reject: two buttons, mutually exclusive active state (mockup shows
  a filled blue "Accepted" + outline "Reject" when accepted; presumably the
  mirror when rejected). Both call `useUpdateConvention(candidate.id)` with
  `{ status: 'accepted' | 'rejected' }`. A third implicit state,
  `'pending'`, is what a fresh candidate starts in — neither button filled.
- Inline rule edit: per requirement ("едитувати конкретний інсайт") clicking
  the title (or a small edit icon) turns it into a text input, saved via the
  same `useUpdateConvention` with `{ rule }` on blur/Enter — no separate
  modal for single-candidate edits, that would be over-building for a
  one-line string. The category isn't shown on the mockup cards; if it's
  surfaced at all, a small non-editable chip is enough — no dedicated
  category editor UI for v1.

`page.card.accepting` (already seeded: "Accepting…") is the button's
in-flight label during the optimistic mutation's actual network round-trip
(rare to see given optimistic update, but covers slow networks / the
mutation failing and rolling back).

## Create-skill modal

New `ConventionsView/_components/CreateSkillFromConventionsModal/` — a
**client-only bundling step**, per `server/specs/conventions-
extractor.md`'s explicit "no new server route for skill creation": it POSTs
straight to the existing `POST /skills/import` (reuse
`useConfirmSkillImport` from `client/src/lib/hooks/skills.ts`, already
specified in `client/specs/skills.md` — do not add a parallel hook).

- Opens with all currently-`accepted` candidates from the current scan
  pre-merged into a single markdown body, client-side:

  ```md
  # <slug-of-repo>-conventions

  <one-line description>

  ## <slugified-rule-1>
  <rule-1 text>.

  Detected in `<evidence_path>:<evidence_line_start>-<evidence_line_end>`:
  ```<lang-agnostic fence>
  <evidence_snippet>
  ```

  ## <slugified-rule-2>
  ...
  ```

  matches the second mockup's rendered body (`# payments-api-conventions`,
  `## async-await-then-chains`, "Detected in `file:line`:") almost exactly.
- Form fields: **Name** (default `<repo-slug>-conventions`), **Description**
  (default `"N house conventions extracted from <repo>"`, editable),
  **Type** (`SelectInput`, default `'convention'` — reuses the same
  `SkillType` enum and the same field component `ConfigTab.tsx` already uses
  per `client/specs/skills.md`), **Enabled** toggle (default on — note this
  is a **client-side default only**; the server's `confirmImport` still
  force-writes `enabled:false` on create regardless of what this toggle
  sends, per the Trust model in `server/specs/skills.md` — the toggle's
  value is discarded server-side and the modal's footer message should say
  so, or simply not show the toggle at all to avoid promising something the
  API won't honor. **Decision: drop the Enabled toggle from this modal** —
  showing a control whose value is silently ignored is worse than not
  showing it; the resulting skill always lands disabled-pending-vet, exactly
  like every other import path, and the user flips it on from the Skills
  list once satisfied).
- **Skill body**: editable markdown textarea (mono, matches `ConfigTab`'s
  body field), pre-filled with the merged markdown above, with a small
  "N tokens" counter — client-side estimate only (no tokenizer dependency in
  this client; a `text.length / 4` heuristic is fine for a UI hint, it does
  not need to match the server's `TiktokenTokenizer` exactly since nothing
  downstream trusts this number).
- Footer: **Cancel** / **Create skill** (primary). On success: toast + close
  + link to the new skill's page (`/skills/:id`) — mirrors the import
  drawer's confirm-step success framing in `client/specs/skills.md`
  ("Imported ... Disabled until you vet + enable it.", adapted copy).
- `source: 'extracted'`, `evidence_files: [...unique evidence_path values
  from the merged candidates]` are set by the client request body — the
  server still independently forces `source`, this is just supplying the
  value the server already expects for this path (`ConfirmImportBody`'s
  `source: ImportSource` field, `server/src/modules/skills/routes.ts`).

**"Selected" == "accepted", not a separate multi-select step**: the written
requirement's "go to a skill-edit modal from the insights I selected" is
satisfied by treating every currently-`accepted` candidate as "selected" —
there is no additional checkbox layer on top of accept/reject. A user who
wants only a subset of already-accepted candidates in this particular skill
first flips the others back to `pending`/`rejected`, then opens the modal.
This is a deliberate simplification (matches both mockups: the "Deselect
all" action + "N of M accepted" counter operate on the same accepted set the
modal bundles, there's no separate selection UI shown), not an oversight —
called out explicitly here rather than left implicit.

No candidate-to-skill back-reference is written anywhere on success (server
spec's explicitly-not-doing) — closing the modal just leaves the candidates
`accepted` in their current (soon-to-be-superseded-by-next-scan) list.

## i18n

`client/messages/en/conventions.json` — keep every existing key as-is
(reused verbatim: `page.crumbLab`, `page.crumbConventions`,
`page.headingPrefix`, `page.repoFallback`, `page.subtitle`, `page.scanning`,
`page.rescan`, `page.runExtraction`, `page.extractionFailed`,
`page.loadError`, `page.empty.*`, `page.candidateCount`,
`card.confidence`). Repurpose `card.acceptAsSkill`/`card.accepted`/
`card.accepting` as the accept-toggle's three states (not per-candidate
skill creation, per the Conflict section above). Add:

- `page.detectedFrom` (sample-count meta line)
- `page.deselectAll`, `page.acceptedOf` (`"{accepted} of {total} accepted"`)
- `page.createSkill` (button label)
- `card.reject`, `card.rejected` (the missing mirror of `accepted`/
  `accepting`)
- `card.editRule` (a11y label for the inline edit affordance)
- `modal.*` — title (`"Create skill from conventions"`), the "Merged from N
  accepted conventions in `<repo>`" banner copy, field labels, success toast

## e2e coverage

Next numbered flow after whatever `client/specs/skills.md`'s
`08-skills.flow.json` becomes (check `e2e/CLAUDE.md` for the current count) —
covering: run extraction on the seeded demo repo (reproducible fixture scan,
see `server/specs/conventions-extractor.md`'s Reproducibility section, so
this flow never depends on a real LLM call) → accept 2 of 3 candidates,
reject 1 → open Create-skill modal, confirm the merged body contains exactly
the 2 accepted candidates and not the rejected one → create → land on the
new skill's page with `enabled: false` and `source: 'extracted'` badge
visible (`SkillCard`'s existing source-badge rendering, `client/specs/
skills.md`).

## Explicitly not doing

- No per-candidate "create skill" action (see Conflict section) — batch only.
- No category filter/grouping UI on the candidate list.
- No syntax-highlighted code block for evidence snippets — plain monospace,
  matching this client's existing no-highlighter precedent.
- No "already merged into skill X" indicator on a candidate (server has no
  back-reference to show, see server spec).
- No Enabled toggle in the create-skill modal (server ignores it; showing a
  no-op control is worse than omitting it).
- No new tokenizer dependency for the client-side token-count hint.
