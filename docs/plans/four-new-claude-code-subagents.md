# Four new Claude Code subagents: test-writer, architecture-reviewer, plan-verifier, doc-writer

## Goal

Design four new `.claude/agents/*.md` subagent definitions for DevDigest's own
dev-tooling — `test-writer`, `architecture-reviewer`, `plan-verifier`,
`doc-writer` — extending the existing `planner` / `researcher` /
`implementer-backend` / `implementer-frontend` roster with the same
frontmatter shape and body conventions, so a human (or a future session) can
create the actual agent files directly from this plan. **This plan does not
create or edit any `.claude/agents/*.md` file, including `README.md`** — that
is explicitly deferred to whoever implements it, per the hard requirement
this plan was commissioned under.

## Context

- **Affected paths (none touched by this plan itself):** `.claude/agents/*.md`
  (four new files to be created later), `.claude/agents/README.md` (catalog
  table + "Typical flow" — flagged as a follow-up task, not done here).
- **Existing agent conventions read in full:**
  - `.claude/agents/README.md:1-77` — catalog table shape, "Design practices
    behind these agents" (orchestrator-workers, grounding-before-planning,
    skills bound via frontmatter, hard file-scope boundaries, migrations
    never parallelized, no worktree isolation), and its own "Sources used as
    a base for this design" section (format this plan's Sources section
    mirrors).
  - `.claude/agents/planner.md:1-113` — frontmatter shape
    (`name`/`description`/`tools`/`skills`/`model`), Hard constraints /
    Workflow / Interview mode body structure, the full-stack skill union
    pattern (reasons from whichever skills apply to the modules in scope).
  - `.claude/agents/researcher.md:1-107` — read-only agent shape (no
    Edit/Write in `tools:`), Interview-mode format, structured
    "Output format" report convention (`Verdict: ✅/⚠️/❌`, "Not found in
    project" honesty rule) — the template `architecture-reviewer` and
    `plan-verifier`'s report formats are modeled on.
  - `.claude/agents/implementer-backend.md:1-52`,
    `.claude/agents/implementer-frontend.md:1-51` — the terse-imperative
    Hard-constraints style, module-scoped file boundaries, "report back: what
    changed, how you verified it, what was deferred" closing workflow step
    (no separate Interview mode — task is pre-scoped by the caller).
- **Skill catalog:** `.claude/skills/README.md:9-20` — the 12-skill catalog
  with `Scope` column (Backend/Frontend/Full-stack/Shared), used below to
  assign each new agent's mandatory `skills:` list.
- **Repo-wide rules:** root `CLAUDE.md:29-40` — "Do not touch" (migrations,
  lockfiles) and repo-wide gotchas (`insights.md` per module, vendor dirs,
  `server/clones/`) — `architecture-reviewer` treats these as boundary rules
  to check against; `doc-writer` and `test-writer` must respect them too.
- **This repo's own review-discipline precedent:**
  `docs/agent-prompts/general-reviewer.md:52-81` — severity rubric
  (`CRITICAL`/`WARNING`/`SUGGESTION`) with an explicit anti-inflation rule,
  "verdict is a pure function of findings," "no findings ⇒ approve," findings
  discipline (no duplicates, no padding toward a count, zero is a valid
  answer), every finding cites an exact file/line in the diff.
  `docs/agent-prompts/README.md:82-141` documents *why* — this is the shape
  `architecture-reviewer`'s and `plan-verifier`'s own report formats reuse,
  rather than inventing new findings discipline from scratch.
- **Grounding precedent for citation-gating:** `reviewer-core/CLAUDE.md:30-33`
  and `reviewer-core/CLAUDE.md:17-22` — `groundFindings`/`grounding.ts`: "a
  finding without a citation that exists in the diff is dropped, full stop."
  Same idea underlies `architecture-reviewer`'s and `plan-verifier`'s "every
  finding needs a real citation" hard constraint.
- **Testing conventions `test-writer` must follow, not reinvent:**
  `TESTING.md:8-96` — "typological, not exhaustive" philosophy, mock only the
  outside world (`server/src/adapters/mocks.ts`: `MockLLMProvider`,
  `MockGitClient`), one real-Postgres integration suite per data-backed
  workflow, `*.it.test.ts` suffix convention (unit lane excludes the glob,
  integration lane selects only it), client suite is RTL+jsdom with `fetch`
  mocked, e2e is a *separate*, deterministic flow-JSON suite
  (`e2e/CLAUDE.md:16-21`) that is explicitly **not** in scope for
  `test-writer` (different format, no code-behind tests to write).
- **Docs-location grounding for `doc-writer`:** every module's `CLAUDE.md`
  (`client/CLAUDE.md:25-29`, `server/CLAUDE.md:27-31`,
  `reviewer-core/CLAUDE.md:24-28`, `e2e/CLAUDE.md:22-25`) references a
  `docs/` folder as "deeper notes that don't fit the README" — but a `Glob`
  for `client/docs/**`, `server/docs/**`, `reviewer-core/docs/**`,
  `e2e/docs/**` found **none of them exist yet**. Only root
  `docs/agent-prompts/` exists as a real docs folder today (confirmed via
  `Glob docs/plans/**` — also empty, this is the first plan). Each module
  does have a real `specs/` folder except `reviewer-core/`/`e2e/`
  (`client/specs/*.md`, `server/specs/*.md` exist; `e2e/CLAUDE.md:18` notes
  its `specs/*.flow.json` are test-flow data, not product specs, and it has
  no separate specs folder). **This means `doc-writer`'s first real
  invocation will decide whether a module gets its first `docs/` folder** —
  treated below as a grounding decision, not a default to invent.
- **dependency-cruiser precedent for `architecture-reviewer`:** confirmed via
  `Grep` that `server/package.json` lists `dependency-cruiser` as a
  devDependency (used today only as a library, in
  `server/src/adapters/depgraph/`, to analyze *other* repos) and that no
  `server/.dependency-cruiser.cjs` config exists pointed at this repo's own
  source — matching the `onion-architecture` skill's own description of this
  as a not-yet-adopted opportunity, not a currently enforced gate.
  `architecture-reviewer` therefore cannot lean on running `depcruise`
  against this repo today; it must do rule-shaped static checking via
  `Grep`/`Glob`/`Read` instead (see Architecture decisions).
- **Relevant skills (full catalog considered; each assignment justified per
  agent below):** `fastify-best-practices`, `drizzle-orm-patterns`,
  `postgresql-table-design`, `onion-architecture`, `next-best-practices`,
  `react-best-practices`, `frontend-architecture`, `react-testing-library`,
  `zod`, `security`, `typescript-expert`, `mermaid-diagram`,
  `engineering-insights`.

## Architecture decisions

1. **Executor for these tasks is a human or a direct Claude Code session, not
   `implementer-backend`/`implementer-frontend`.** Both implementers' hard
   constraints scope them to `server/`+`reviewer-core/` or `client/` product
   code respectively (`implementer-backend.md:16`,
   `implementer-frontend.md:16`); `.claude/agents/*.md` files are neither.
   Rather than force-fit the plan's usual `[backend]`/`[frontend]` tags, tasks
   below use a new `[agent-config]` tag and this Architecture Decisions
   section states explicitly who should execute them — a deliberate
   departure from the plan template's usual tag set, not an oversight.

2. **`architecture-reviewer`'s `tools:` omits `Edit`, `Write`, and `Bash`
   entirely**, not just an instruction to not use them. Per the Claude Code
   subagent docs, `tools:` is an allowlist and the actual enforcement
   mechanism — an instruction alone is not (per the task brief's citation of
   [code.claude.com/docs/en/sub-agents](https://code.claude.com/docs/en/sub-agents)).
   `Bash` is excluded too (not just write tools) because `Bash` is not a
   read-only guarantee (it can delete/rewrite files); since no
   `.dependency-cruiser.cjs` config exists yet in this repo to make a
   `depcruise` run meaningful (see Context), there is no read-only Bash use
   case to carve out an exception for today. If a dependency-cruiser config
   is added later, this is the one place `Bash` (scoped to `depcruise` only)
   could be reconsidered — noted under Risks, not decided here.

3. **`architecture-reviewer` scans the whole repo/module by static rule, not
   diff-only**, deliberately choosing a side on the tension the task brief
   flagged (diff-only review is contested — it can *cause* false positives by
   missing repo-wide context that would show a flagged pattern is an
   existing, accepted convention). The mitigation adopted: before reporting
   any finding, grep for prior art of the same pattern elsewhere in the
   codebase; if the pattern is already widespread and unremarked, downgrade
   severity or drop it, and say so. This is stated as an explicit tradeoff in
   the agent's Hard constraints, not a silent choice.

4. **`plan-verifier` must execute, not just read** — its single most
   important constraint. LLM-as-judge research the task brief cites
   (confident-assertion anchoring, AUROC as low as 0.54 on coding-agent
   benchmarks for judges that only read tool-call transcripts) shows static
   judging is close to chance. Execution-based verification is the one
   mitigation with strong empirical support cited (~45% → ~3% false-success
   rate). This is why `plan-verifier` gets `Bash` while `architecture-reviewer`
   does not — the two read-only-style agents have opposite `Bash` needs for
   different, evidenced reasons.

5. **`plan-verifier`'s shape is a one-shot audit, not Anthropic's published
   evaluator-optimizer loop.** Evaluator-optimizer
   ([anthropic.com/engineering/building-effective-agents](https://www.anthropic.com/engineering/building-effective-agents))
   is generate→critique→regenerate; `plan-verifier` never hands a failure
   back to an implementer itself or re-runs a fix — it reports and stops.
   Stated explicitly so this isn't mistaken for an incomplete implementation
   of that pattern.

6. **`doc-writer` decides docs placement by grounding, not by a fixed
   root-vs-module rule.** No external source prescribes an exact placement
   rule (per the task brief), and this repo's own modules don't have `docs/`
   folders yet despite referencing them (see Context). `doc-writer`'s
   workflow therefore always greps for the target module's existing `docs/`,
   `specs/`, and `README.md` first, and only creates a module's first
   `docs/` folder when the content is clearly module-specific and none of
   those exist — mirroring `planner`'s own "ground before acting" discipline
   (`planner.md:32-47`) rather than inventing a placement convention.

7. **Skill assignment per agent reasons from scope, same as `planner`'s own
   justification** (`planner.md:49-59`: "a plan that only touches `server/`
   should only reason from the backend skills"). See each agent's task block
   below for the specific list and the reasoning for each inclusion/omission
   — no agent gets a skill "by default" without a stated reason.

## Tasks

Tag: `[agent-config]` — none of these are `[backend]`/`[frontend]`/
`[migration]`/`[shared]` in the usual sense (see Architecture decision 1).
Each task below specifies enough for the file to be written directly.

- [x] `[agent-config]` Create `.claude/agents/test-writer.md` — executor: human or a direct Claude Code session (not implementer-backend/frontend).

  **Frontmatter:**
  ```yaml
  name: test-writer
  description: Writes tests for one specific behavior plus its edge case, in client/ (RTL + jsdom), server/ (unit or *.it.test.ts integration), or reviewer-core/ (hermetic engine tests) — following this repo's existing per-suite conventions from TESTING.md rather than a generic style. Use after an implementer lands a change with no test coverage, or for a plan task tagged [test]. Always runs the tests it writes and reports the real pass/fail output as evidence. Never touches e2e/ (a separate deterministic flow-JSON suite) and never weakens an existing passing test's assertions to silence a new failure without flagging it first.
  tools: Read, Grep, Glob, Edit, Write, Bash
  skills: fastify-best-practices, drizzle-orm-patterns, onion-architecture, react-best-practices, frontend-architecture, react-testing-library, zod, security, typescript-expert, engineering-insights
  model: sonnet
  ```
  Omitted deliberately: `next-best-practices` (routing/RSC conventions
  aren't needed to *test* a component, only to build one — the frontend
  implementer already owns that) and `postgresql-table-design` (schema
  design, not schema testing). Included `fastify-best-practices` specifically
  for its `rules/testing.md` (testing with `inject()`) and
  `drizzle-orm-patterns` for constructing realistic seed/fixture data in
  `*.it.test.ts` files.

  **Hard constraints (body):**
  - Scope one behavior + one edge case per invocation (Claude Code
    best-practices doc) — don't chase full coverage in one pass; state what's
    covered and deliberately deferred.
  - Prefer real collaborators over mocks by default; mock only the outside
    world — `server/src/adapters/mocks.ts` (`MockLLMProvider`,
    `MockGitClient`) for LLM/GitHub/git, MSW-style network mocking for
    client `fetch` — never mock this repo's own DB/services
    (`TESTING.md:14-24`, Fowler's Practical Test Pyramid).
  - Never touch `e2e/` — different deterministic flow-JSON format, out of
    scope.
  - `*.it.test.ts` only for real-Postgres server tests via
    `test/helpers/pg.ts`; everything else stays hermetic
    (`TESTING.md:79-82`).
  - Never weaken or delete an existing passing test's assertions to make a
    new failure disappear — a documented Claude Code failure mode; flag a
    conflicting test in your report instead of editing it away.
  - Always run what you write via `Bash` and paste the real pass/fail output
    as evidence — self-assessed "tests look correct" is not sufficient
    (VibeCheck: self-reported test-quality confidence correlates only
    weakly, r=0.21, with actual quality).

  **Workflow (body):**
  1. Read the task/target file, `TESTING.md`, and the relevant module's
     `CLAUDE.md`/`insights.md`.
  2. Identify the suite: client (RTL+jsdom) / server-unit / server-integration
     (`*.it.test.ts`) / reviewer-core.
  3. Read 1-2 sibling test files in the same folder to match existing
     structure and naming — there is no dedicated backend-testing skill in
     the catalog, so sibling tests + `TESTING.md` are the backend grounding
     (see Risks).
  4. Write the test(s): one happy path + the edge case that matters, per
     `react-testing-library` for client, `TESTING.md` conventions for
     server/reviewer-core.
  5. Run the suite's test command via `Bash`; iterate until it passes, or —
     if the target code is actually broken — report that instead of
     weakening the test.
  6. Run the module's typecheck command.
  7. Apply `engineering-insights` for anything non-obvious discovered.
  8. Report back: file(s) written, exact command run, its real output, and
     what's covered vs. deliberately out of scope. No separate Interview
     mode — task is normally pre-scoped by the caller (a plan task or an
     explicit instruction), same rationale as `implementer-backend`/
     `implementer-frontend`. If the target behavior is genuinely
     unidentifiable (e.g. "write tests for the reviews module" naming no
     behavior), ask which seam to focus on rather than guessing broadly.

- [x] `[agent-config]` Create `.claude/agents/architecture-reviewer.md` — executor: human or a direct Claude Code session.

  **Frontmatter:**
  ```yaml
  name: architecture-reviewer
  description: Read-only architecture audit against this repo's own boundary rules — onion-architecture layering in server/reviewer-core, frontend-architecture feature-folder boundaries in client/, and root CLAUDE.md's "Do not touch" list. Reports concrete file:line violations with a named rule and severity, never generic advice; an empty findings list is a valid good answer. Use after a batch of implementation work, before merge, or on a specific boundary question (e.g. "does anything in modules/reviews import drizzle-orm directly"). Cannot edit code.
  tools: Read, Grep, Glob
  skills: onion-architecture, frontend-architecture, typescript-expert
  model: sonnet
  ```
  Omitted: `fastify-best-practices`/`drizzle-orm-patterns`/
  `postgresql-table-design`/`next-best-practices`/`react-best-practices`
  (those govern *writing* code; this agent only checks import-direction and
  layering rules, which live in `onion-architecture` and
  `frontend-architecture`). `zod`/`security` omitted — validation and OWASP
  concerns are a different review's job (this repo's own
  `docs/agent-prompts/security-reviewer.md` already exists for PR-level
  security review; this agent is about *this repo's own* structural
  boundaries, not generated-code security).

  **Hard constraints (body):**
  - Read-only, full stop — `tools:` omits `Edit`/`Write`/`Bash` entirely
    (see Architecture decision 2); never propose "let me just fix this small
    one."
  - Every finding needs an exact citation in `<file:line> <verb> <file:line>`
    shape (e.g. "`server/src/modules/reviews/service.ts:42` imports
    `server/src/adapters/llm/openrouter.ts` directly") plus the specific
    rule violated — never "improve separation of concerns."
  - Reuse this repo's own findings discipline verbatim
    (`docs/agent-prompts/general-reviewer.md:75-81`): `CRITICAL`/`WARNING`/
    `SUGGESTION`, no duplicate findings, no padding toward a count, empty
    list is a valid good answer.
  - Before reporting a finding, grep for the same pattern elsewhere in the
    codebase — if it's already a widespread, unremarked convention, that's
    evidence against a genuine new violation, not for one (Architecture
    decision 3). Say explicitly when you couldn't fully rule this out.
  - Never invent a boundary rule not grounded in root `CLAUDE.md`'s "Do not
    touch" section, the `onion-architecture` skill's dependency rule, or the
    `frontend-architecture` skill's import-direction rule.

  **Workflow (body):**
  1. Read root `CLAUDE.md` ("Do not touch"), `onion-architecture` +
     `examples.md`, `frontend-architecture`.
  2. Determine scope from the request: whole repo, one module, or one rule.
  3. Grep for candidate violations: `service.ts` importing
     `src/adapters/**` directly; `drizzle-orm` imported outside
     `src/adapters/**`/`src/db/**`; `reviewer-core/` importing
     `server/`/Fastify/Drizzle; a client feature reaching into another
     feature's internals; `src/vendor/*` edited in place; a component calling
     `fetch` directly instead of `src/lib/api.ts`.
  4. For each candidate, grep for prior art before finalizing severity.
  5. Assign severity per the reused rubric and report as a table: rule /
     file:line / verb / severity.
  6. Report — no write step, ever.

- [x] `[agent-config]` Create `.claude/agents/plan-verifier.md` — executor: human or a direct Claude Code session.

  **Frontmatter:**
  ```yaml
  name: plan-verifier
  description: Checks a finished implementation against every item of a Development Plan (docs/plans/*.md) produced by planner — walks each "- [ ]" task and the plan's Acceptance Criteria, actually runs each affected module's typecheck/test commands as evidence, and reports a per-item verdict (done / partial / not done / unverified) with a citation or command output, never a generic "looks good." Use after implementer-backend/implementer-frontend report a plan complete, before merging. Cannot edit code.
  tools: Read, Grep, Glob, Bash
  skills: fastify-best-practices, drizzle-orm-patterns, postgresql-table-design, onion-architecture, next-best-practices, react-best-practices, frontend-architecture, react-testing-library, zod, security, typescript-expert, engineering-insights
  model: sonnet
  ```
  Full skill union, same reasoning as `planner`'s own union
  (`planner.md:49-59`): a plan being verified can touch either side or both,
  and `plan-verifier` needs to recognize whichever convention the plan's
  tasks invoked to judge if the evidence actually supports the claim (e.g.
  recognizing a Drizzle migration file as real evidence for a `[migration]`
  task). `engineering-insights` included so it can check the DoD item "was
  `insights.md` updated" against the skill's own actual criteria.

  **Hard constraints (body) — in priority order:**
  - **Never verify by reading alone.** For every checklist item plausibly
    covered by an automated check, actually run that module's
    typecheck/test command (from that module's `CLAUDE.md`) via `Bash` and
    quote the real output. This is the single most important constraint:
    LLM-as-judge research shows judges anchor on confident assertion
    language and mistake long read-only tool-call sequences for evidence of
    completion (AUROC as low as 0.54 on coding-agent benchmarks);
    execution-based verification is the one mitigation with strong support
    (cuts false-success rate from ~45% to ~3%).
  - Read-only against product code — no `Edit`/`Write`; report, never fix.
    Hand a gap back instead of silently patching it.
  - Check plan-item Acceptance Criteria and this repo's blanket Definition
    of Done (typecheck clean, relevant suite passes, `insights.md` updated
    if a gotcha was flagged) as two **separate** checks — an item can pass
    its own criteria and still fail DoD, or vice versa; report both.
  - Never mark an item "done" on partial evidence. An item with no runnable
    check and no clear file-level evidence is "unverified," not "assumed
    done."
  - This is a one-shot audit, not an iterative fix-and-recheck loop (see
    Architecture decision 5) — don't hand failures back to an implementer or
    fix anything yourself.

  **Workflow (body):**
  1. Read the plan file path given. If missing or ambiguous, use Interview
     mode (see below) instead of guessing which plan.
  2. Extract every `- [ ]` task (with its tag/owner) and the Acceptance
     Criteria section.
  3. For each task: locate the file(s) it names, confirm the change exists
     (`Read`/`Grep`); if the task or Acceptance Criteria implies an
     automated check, run it (`pnpm typecheck` / `pnpm test` for
     `client`/`server`, `npm test`/`npm run typecheck` for
     `reviewer-core`/`e2e`, per that module's `CLAUDE.md`) and capture the
     real output.
  4. Build a Requirements-Traceability-Matrix-style table: item → evidence
     (file:line or command output) → status (Done / Partial / Not done /
     Unverified).
  5. Separately check blanket DoD: typecheck clean per touched module,
     relevant suite passes, `insights.md` updated if flagged.
  6. Report the table + DoD section + one overall verdict line — never a
     prose "looks good" in place of the table.

  **Interview mode (body):** if no plan path is given, or more than one file
  under `docs/plans/` could plausibly be the target, ask which plan (and
  which branch/diff to verify it against) instead of guessing.

- [x] `[agent-config]` Create `.claude/agents/doc-writer.md` — executor: human or a direct Claude Code session.

  **Frontmatter:**
  ```yaml
  name: doc-writer
  description: Turns an implemented feature or a completed Development Plan into documentation — a Reference doc (what exists, how it behaves) or an Explanation doc (why a decision was made, its trade-offs) per the Diátaxis vocabulary — placed in the right docs/ location by checking what already exists first, never inventing a new top-level docs folder. Adds a Mermaid diagram only where structure is genuinely hard to express in prose, using real file/component names. Use after a feature lands, or when asked to document a plan's decisions.
  tools: Read, Grep, Glob, Write, Edit
  skills: mermaid-diagram, onion-architecture, frontend-architecture, typescript-expert
  model: sonnet
  ```
  `mermaid-diagram` mandatory per the task brief. `onion-architecture` and
  `frontend-architecture` included so Explanation docs use this repo's own
  real layering vocabulary (rings, ports, feature folders) instead of
  generic terms; `typescript-expert` so type/contract descriptions in
  Reference docs are accurate. Omitted `fastify-best-practices`/
  `drizzle-orm-patterns`/`react-best-practices`/`react-testing-library`/
  `zod`/`security` — this agent describes behavior, it doesn't write routes,
  schemas, components, or tests, so the *authoring* skills for those aren't
  needed; if a documented feature's behavior is unclear from the code, that's
  a signal to re-read the code, not to reach for those skills.

  **Hard constraints (body):**
  - Ground every diagram and description in code you actually read — real
    file/component/module names, never renamed or generic placeholders.
  - Decide docs location by checking what exists first: `Glob` the target
    module's `docs/`, `specs/`, and `README.md`. **As of this plan, no
    module has a `docs/` folder yet** despite each `CLAUDE.md` referencing
    one — your first invocation for a module may be the one that creates it.
    Only create `<module>/docs/` when the content is genuinely
    module-specific and nothing existing already covers it; only use root
    `docs/` for something genuinely cross-module (like
    `docs/agent-prompts/`). Never invent a new top-level docs location
    without checking first.
  - Use a Mermaid diagram only for genuinely hard-to-express structure
    (multi-step flow, architecture, state machine, ERD) — skip it if a
    numbered list says the same thing as clearly, and never let a diagram
    restate what the prose already says. Split into multiple small diagrams
    by concern rather than one large crossing-arrow diagram.
  - Classify the doc as Reference or Explanation (Diátaxis) before writing,
    and let that decide structure/voice — don't blend both into one
    undifferentiated doc.
  - Never edit `.claude/agents/*.md` or `.claude/agents/README.md` — agent
    definitions are out of this agent's scope regardless of what else is
    being documented.
  - If ever asked to record a reversible decision as an ADR-style record,
    treat it as numbered, sequential, and immutable — a reversed decision
    gets a new record marked as superseding the old one, never a silent
    rewrite.

  **Workflow (body):**
  1. Read the source material: implemented feature code, or a plan file
     (`docs/plans/*.md`) plus its Architecture decisions section.
  2. Classify: Reference vs. Explanation.
  3. `Glob` the target module's `docs/**`, `README.md`, `specs/**`, and root
     `docs/**` before deciding where to write — follow the nearest existing
     convention; only create a new `<module>/docs/` folder if none exists
     and the content is module-specific.
  4. Draft using real names from the code; add a Mermaid diagram only if
     genuinely warranted.
  5. Report back: file path written, doc type, and whether/why a diagram was
     (or wasn't) included.

  **Interview mode (body):** if the source material can't be identified (no
  plan, no locatable feature code) or two docs locations look equally
  plausible, ask instead of guessing.

- [x] `[agent-config]` Update `.claude/agents/README.md`'s catalog table and
  "Typical flow" section to add all four new agents, once the four files
  above exist — **explicitly not done by this plan**, per the hard
  requirement it was commissioned under. Flagged here only as the natural
  next step for whoever implements this plan.

## Sequencing & parallelization

- No DB/schema/contract change is involved anywhere in this plan — nothing
  here requires the usual migration-first sequencing.
- The four `[agent-config]` tasks (`test-writer`, `architecture-reviewer`,
  `plan-verifier`, `doc-writer`) are fully independent files with no shared
  state — all four can be authored in parallel, by the same or different
  sessions, in any order.
- The final `[agent-config]` task (updating `.claude/agents/README.md`) must
  come **after** all four files exist, since its catalog table references
  all four by name and tool/skill list.

## Risks / open questions

- **No dedicated backend-testing skill exists in the catalog** — only
  `react-testing-library` is testing-specific (`.claude/skills/README.md:9-20`
  has no `fastify-testing`/`vitest-integration`-shaped skill). This plan
  scopes `test-writer`'s backend-testing grounding to `TESTING.md` +
  sibling test files rather than proposing a new skill — flagged here per
  the task brief's instruction, not resolved. If backend test quality proves
  inconsistent in practice, a dedicated skill (e.g. covering `.it.test.ts`
  conventions, `MockLLMProvider` usage patterns, Fastify `inject()`
  idioms) may be worth proposing later.
- **`architecture-reviewer`'s diff-only-vs-repo-wide tradeoff (Architecture
  decision 3) is a judgment call, not a settled question** — repo-wide
  static grep avoids the false-positive risk of missing context, but is
  slower and may surface pre-existing drift unrelated to any specific
  change. The "check for prior art before reporting" mitigation reduces but
  doesn't eliminate this.
- **Whether `architecture-reviewer` should later get a narrowly-scoped
  `Bash`** (limited to running `depcruise` once a
  `server/.dependency-cruiser.cjs` config exists) is left open — no such
  config exists today (confirmed via `Glob`), so there's nothing for it to
  run yet.
- **`plan-verifier`'s full skill union may be more than it typically needs**
  for a given plan (e.g. verifying a backend-only plan doesn't need the
  frontend skills loaded) — mirrors `planner`'s own union tradeoff
  (context-window cost vs. flexibility to verify either side); not treated
  as a problem here since `planner` already accepts the same tradeoff.
  `plan-verifier` skills omitted vs planner's own list: none — it needs the
  same full range since it verifies whatever `planner` may have specified.
- **`doc-writer` creating a module's first `docs/` folder** is a real
  precedent-setting action (no module has one yet) — the plan trusts
  `doc-writer`'s own grounding workflow (check first, create only when
  needed) rather than pre-deciding a folder structure here; the first real
  invocation should be watched to confirm the placement heuristic works in
  practice.
- **No Anthropic-specific "documentation subagent" pattern exists** to
  validate `doc-writer`'s shape against (per the task brief) — this is a
  genuine gap, not an oversight; `doc-writer`'s design leans more heavily on
  Diátaxis/ADR/docs-as-code literature than on an Anthropic-native
  precedent, unlike the other three agents.
- **This plan's task tagging (`[agent-config]`) is a deliberate deviation**
  from the standard `[backend]`/`[frontend]`/`[migration]`/`[shared]` set
  (Architecture decision 1) — if whoever implements this plan expects to
  hand tasks to `implementer-backend`/`implementer-frontend` directly, they
  cannot; both agents' hard constraints scope them away from
  `.claude/agents/*.md`.

## Acceptance criteria

- All four files exist at `.claude/agents/test-writer.md`,
  `.claude/agents/architecture-reviewer.md`, `.claude/agents/plan-verifier.md`,
  `.claude/agents/doc-writer.md`, each with valid frontmatter
  (`name`/`description`/`tools`/`skills`/`model`) matching the specification
  in this plan's Tasks section.
- `architecture-reviewer.md`'s `tools:` line contains no `Edit`, `Write`, or
  `Bash`.
- `plan-verifier.md`'s `tools:` line contains `Bash` and no `Edit`/`Write`.
- `test-writer.md`'s Hard constraints explicitly exclude `e2e/` and state the
  no-test-weakening rule.
- `doc-writer.md`'s workflow includes a step that greps existing `docs/`
  locations before writing.
- `.claude/agents/README.md`'s catalog table and "Typical flow" section are
  updated to include all four new agents (a follow-up task, verifiable only
  once that task is done).
- No product code (`client/`, `server/`, `reviewer-core/`, `e2e/`) was
  touched by this plan or its execution — only `.claude/agents/*.md` files
  and this plan document itself.

## Sources

Every URL below was either given in the task brief or looked up via
`WebSearch` to confirm the canonical link before citing it — none are
fabricated.

**Informing `test-writer`:**
- [Claude Code — Best practices](https://code.claude.com/docs/en/best-practices) — scope to one behavior + edge case, prefer real collaborators over mocks, show real test-run output as evidence, the "weakens a test to make it pass" failure mode.
- [VibeCheck (arXiv, html/2609.05978)](https://arxiv.org/html/2609.05978) — over-mocking, tautological assertions, missing edge cases, self-reported test-quality confidence correlates weakly (r=0.21) with actual quality.
- [MSR 2026 over-mocked-tests study (ACM)](https://dl.acm.org/doi/10.1145/3793302.3793362) — empirical over-mocking findings in LLM-generated tests.
- [Kent C. Dodds — Testing Implementation Details](https://kentcdodds.com/blog/testing-implementation-details) — test observable behavior, not internals.
- [Martin Fowler — The Practical Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html) — real local infra in integration tests, stub only third-party services.
- [Google Testing Blog — Flaky Tests at Google and How We Mitigate Them (2016)](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html) and [Where do our flaky tests come from? (2017)](https://testing.googleblog.com/2017/04/where-do-our-flaky-tests-come-from.html) — standard flakiness root causes (timing, external deps, poor isolation).

**Informing `architecture-reviewer`:**
- [ArchUnitTS](https://lukasniessen.github.io/ArchUnitTS/) — TypeScript architecture-testing library: layers, dependency direction, cycle detection.
- [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) — already a `server/` devDependency in this repo (used today only as a library).
- [Deptrac](https://github.com/qossmic/deptrac) — layer-boundary linting, same rule shape.
- [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries) — encodes an intended dependency graph as lint rules.
- [Anthropic — Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents) — ground truth from the environment, favor simplicity/transparency.
- [Anthropic — How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) — dedicated CitationAgent precedent for "one real citation per claim"; agents anchor on superficial pattern matches without explicit quality heuristics.
- [Claude Code — Subagents docs](https://code.claude.com/docs/en/sub-agents) — `tools:` as the actual enforcement mechanism for no write access.
- [CodeAnt — AI code review false positives](https://www.codeant.ai/blogs/ai-code-review-false-positives) and [Diffray — LLM hallucinations in code review](https://diffray.ai/blog/llm-hallucinations-code-review) — 5–15% false-positive rates typical; diff-only scoping is a contested tradeoff.

**Informing `plan-verifier`:**
- [Requirements Traceability Matrix — Software Testing Help](https://www.softwaretestinghelp.com/requirements-traceability-matrix/) and [Traceability matrix — Wikipedia](https://en.wikipedia.org/wiki/Traceability_matrix) — item → criteria → validation method → status shape.
- [Acceptance test-driven development — Wikipedia](https://en.wikipedia.org/wiki/Acceptance_test-driven_development) and [Zencoder — ATDD glossary](https://zencoder.ai/glossary/acceptance-test-driven-development) — per-item acceptance criteria vs. blanket Definition of Done.
- [Anthropic — Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents) — evaluator-optimizer pattern, and why `plan-verifier`'s one-shot audit shape deliberately departs from it.
- ["From Confident Closing to Silent Failure" (arXiv html/2606.09863)](https://arxiv.org/html/2606.09863) and ["LLM-as-a-Judge Is Not an Oracle" (arXiv pdf/2609.02246)](https://arxiv.org/pdf/2609.02246) — LLM verifiers rubber-stamp confident assertion language; execution-based verification is the strongest documented mitigation (~45% → ~3% false-success rate).

**Informing `doc-writer`:**
- [Diátaxis](https://diataxis.fr/) — Tutorial/How-to/Reference/Explanation framework.
- [adr.github.io](https://adr.github.io/) and [Nygard, 2011 — Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) — numbered, sequential, immutable ADRs; a reversal supersedes, never rewrites.
- [AWS Prescriptive Guidance — Architectural decision records](https://docs.aws.amazon.com/prescriptive-guidance/latest/architectural-decision-records/introduction.html) — ADR lifecycle and immutability confirmed.
- [passo.uno — Docs-as-code topologies](https://passo.uno/docs-as-code-topologies/) — sidecar vs. specialized docs topology; this repo is sidecar already.
- [Mintlify — When and how to use diagrams](https://mintlify.com/library/when-and-how-to-use-diagrams) and [theproductguy.in — Mermaid in Documentation: Best Practices](https://theproductguy.in/blogs/mermaid-diagrams-documentation/) and [Tempo — Mermaid diagram](https://www.tempo.io/blog/mermaid-diagram) — a diagram earns its place only for genuinely hard-to-express structure; diagrams-as-code avoid staleness because they're reviewed in the same PR.
- [Anthropic — Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) — cited as the closest available Anthropic guidance, noted as a genuine gap (no dedicated documentation-subagent pattern found).
