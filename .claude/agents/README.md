# Agents

Custom subagents for DevDigest, invoked via the `Agent` tool (or `@agent-name`
mentions). Canonical location is `.claude/agents/` — same convention as
`.claude/skills/`.

## Catalog

| Agent | Role | Tools | Model | Mandatory skills |
|-------|------|-------|-------|-------------------|
| [researcher](researcher.md) | Read-only research — project or web, reports findings with sources | `Read, Grep, Glob, WebSearch, WebFetch` | sonnet | — |
| [planner](planner.md) | Turns a request into a structured Development Plan written to `docs/plans/` | `Read, Grep, Glob, Write, WebSearch, WebFetch` | sonnet | `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design`, `onion-architecture`, `next-best-practices`, `react-best-practices`, `frontend-architecture`, `react-testing-library`, `zod`, `security`, `typescript-expert`, `engineering-insights` |
| [implementer-backend](implementer-backend.md) | Executes one `[backend]`/`[migration]` plan task against `server/`/`reviewer-core/` | `Read, Grep, Glob, Edit, Write, Bash` | sonnet | `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design`, `onion-architecture`, `zod`, `security`, `typescript-expert`, `engineering-insights` |
| [implementer-frontend](implementer-frontend.md) | Executes one `[frontend]` plan task against `client/` | `Read, Grep, Glob, Edit, Write, Bash` | sonnet | `next-best-practices`, `react-best-practices`, `frontend-architecture`, `react-testing-library`, `zod`, `security`, `typescript-expert`, `engineering-insights` |
| [test-writer](test-writer.md) | Writes tests for one behavior + edge case in `client/`/`server/`/`reviewer-core/`, following `TESTING.md`'s conventions; always runs what it writes | `Read, Grep, Glob, Edit, Write, Bash` | sonnet | `fastify-best-practices`, `drizzle-orm-patterns`, `onion-architecture`, `react-best-practices`, `frontend-architecture`, `react-testing-library`, `zod`, `security`, `typescript-expert`, `engineering-insights` |
| [architecture-reviewer](architecture-reviewer.md) | Read-only audit against onion-architecture/frontend-architecture boundary rules; reports evidence-grounded findings, never generic advice | `Read, Grep, Glob` | sonnet | `onion-architecture`, `frontend-architecture`, `typescript-expert` |
| [plan-verifier](plan-verifier.md) | Checks a finished implementation against every item of a Development Plan, running real typecheck/test commands as evidence per item | `Read, Grep, Glob, Bash` | sonnet | `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design`, `onion-architecture`, `next-best-practices`, `react-best-practices`, `frontend-architecture`, `react-testing-library`, `zod`, `security`, `typescript-expert`, `engineering-insights` |
| [doc-writer](doc-writer.md) | Turns an implemented feature or a plan into Reference/Explanation documentation, with a diagram only where one earns its place | `Read, Grep, Glob, Write, Edit` | sonnet | `mermaid-diagram`, `onion-architecture`, `frontend-architecture`, `typescript-expert` |

## Typical flow

1. `planner` reads the repo (root + module `CLAUDE.md`s, `insights.md`,
   `.claude/skills/README.md`) and writes a sectioned plan to
   `docs/plans/<slug>.md`, tagging each task `[backend]` / `[frontend]` /
   `[migration]` / `[shared]` and stating which tasks are safe to run
   concurrently vs must be sequenced (schema/contract changes and DB
   migrations always go first, never in parallel).
2. `implementer-backend` and `implementer-frontend` each pick up their tagged
   tasks from the plan and execute them — on the same branch/checkout the
   session was invoked on (no worktree isolation; coordination is entirely
   through the plan document, not direct communication between the two).
3. `test-writer` fills any test coverage gaps the implementers left, always
   running what it writes and reporting real pass/fail output as evidence
   rather than asserting the tests are good.
4. `architecture-reviewer` (read-only) and `plan-verifier` (runs real
   typecheck/test commands) check the result before merge — the former for
   onion-architecture/frontend-architecture boundary violations, the latter
   against the plan's own checklist and acceptance criteria, item by item.
5. `doc-writer` turns the shipped feature, or the plan itself, into
   documentation once the above are settled.

## Design practices behind these agents

- **Orchestrator-workers pattern.** `planner` acts as the orchestrator that
  decomposes work; `implementer-backend`/`implementer-frontend` are workers
  that execute one scoped task each and don't know about one another —
  Anthropic's own multi-agent research system uses the same shape.
- **Grounding before planning.** `planner` is required to read the actual
  module `CLAUDE.md`s, `insights.md`, and grep/glob real files before writing
  a single task — never invent a file path. This mirrors how Claude Code's
  own Plan Mode and Cursor's Plan Mode force a read-only repo-research pass
  before producing a plan.
- **The plan as a living, structured artifact.** Markdown with explicit file
  paths and an editable `- [ ]` task checklist, not prose in a chat message —
  the same shape both Claude Code Plan Mode and Cursor Plan Mode converged on
  independently.
- **Skills mandatorily bound per role via the `skills:` frontmatter field.**
  This is a structural guarantee (content preloaded at subagent startup)
  rather than a prompt instruction the model could skip — used to give
  `implementer-backend` and `implementer-frontend` two different fixed skill
  sets, and to give `planner` the union of both so it can reason about
  whichever side a request touches.
- **Hard file-scope boundaries per implementer.** `implementer-backend` never
  touches `client/`; `implementer-frontend` never touches `server/` or
  `reviewer-core/`. Enforced by explicit instruction, not by tool
  restriction — kept as a "Hard constraint" so scope stays clear even without
  git-worktree isolation.
- **DB migrations are never parallelized.** `planner` is required to
  sequence any `[migration]` task before parallel fan-out, and
  `implementer-backend` is the only agent allowed to touch migrations —
  reflects the most common real-world failure mode for parallel coding
  agents sharing one database.
- **Same branch/checkout, no worktree isolation.** By explicit choice for
  this repo — agents operate on the branch they were invoked from rather than
  in an isolated `git worktree`, so coordination relies on the plan's task
  scoping (file/module boundaries) rather than filesystem isolation.

## Sources used as a base for this design

Researched via this repo's own `researcher` agent before writing
`planner`/`implementer-backend`/`implementer-frontend`:

- [Anthropic — Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents) — orchestrator-workers pattern, "ground truth from the environment" over rigid upfront planning, keeping the agent-computer interface simple.
- [Anthropic — How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) — parallel subagents need an explicit objective, output format, and clear task boundaries or they duplicate/collide on work; subagents stay stateless with respect to each other.
- [Claude Code — Subagents docs](https://code.claude.com/docs/en/sub-agents) — subagent frontmatter fields (`tools:`, `model:`, `skills:`); `skills:` preloads full skill content into a subagent's context at startup, which is the mechanism used to bind fixed skill sets per role.
- [Claude Code — Skills docs](https://code.claude.com/docs/en/skills) — hierarchical skill discovery, `disable-model-invocation`/`user-invocable` flags.
- [Cursor — Plan Mode](https://cursor.com/blog/plan-mode) — plan as a persistable Markdown artifact with explicit file references and an editable task list, produced only after a read-only repo-research pass.
- [MindStudio — What Is Parallel Agentic Development?](https://www.mindstudio.ai/blog/parallel-agentic-development-playbook) and [MindStudio — git worktrees + Claude Code](https://www.mindstudio.ai/blog/git-worktrees-claude-code-parallel-development) — only parallelize tasks with clear scope boundaries; shared-database/migration conflicts are the most common failure mode for parallel coding agents (informed the "migrations are never parallelized, single owner" rule, even though this repo doesn't use worktree isolation).
- [MachineLearningMastery — Handling Race Conditions in Multi-Agent Orchestration](https://machinelearningmastery.com/handling-race-conditions-in-multi-agent-orchestration/) — general pattern of giving one agent exclusive ownership of a shared resource instead of trying to make concurrent writes safe.

Researched via this repo's own `researcher` agent (four parallel investigations)
before writing `test-writer`/`architecture-reviewer`/`plan-verifier`/`doc-writer`.
Full design rationale in [docs/plans/four-new-claude-code-subagents.md](../../docs/plans/four-new-claude-code-subagents.md).

**Informing `test-writer`:**
- [Claude Code — Best practices](https://code.claude.com/docs/en/best-practices) — scope to one behavior + edge case, prefer real collaborators over mocks, show real test-run output as evidence, the "weakens a test to make it pass" failure mode.
- [VibeCheck (arXiv, html/2609.05978)](https://arxiv.org/html/2609.05978) — over-mocking, tautological assertions, missing edge cases; self-reported test-quality confidence correlates only weakly (r=0.21) with actual quality.
- [Kent C. Dodds — Testing Implementation Details](https://kentcdodds.com/blog/testing-implementation-details) — test observable behavior, not internals.
- [Martin Fowler — The Practical Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html) — real local infra in integration tests, stub only third-party services.
- [Google Testing Blog — Flaky Tests at Google (2016)](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html) — standard flakiness root causes (timing, external deps, poor isolation).

**Informing `architecture-reviewer`:**
- [ArchUnitTS](https://lukasniessen.github.io/ArchUnitTS/), [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) (already a `server/` devDependency here), [Deptrac](https://github.com/qossmic/deptrac), [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries) — the recurring rule shape across ecosystems: named layers/elements + a directional allow/deny list + cycle detection + severity, reported as a concrete file/class pair, never vague advice.
- [Anthropic — How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) — dedicated CitationAgent precedent for "one real citation per claim."
- [CodeAnt — AI code review false positives](https://www.codeant.ai/blogs/ai-code-review-false-positives) — 5–15% false-positive rates are typical; diff-only scoping is a contested tradeoff (informed the "check for prior art before reporting" mitigation).

**Informing `plan-verifier`:**
- [Requirements Traceability Matrix — Software Testing Help](https://www.softwaretestinghelp.com/requirements-traceability-matrix/), [Traceability matrix — Wikipedia](https://en.wikipedia.org/wiki/Traceability_matrix) — item → criteria → validation method → status shape.
- [Acceptance test-driven development — Wikipedia](https://en.wikipedia.org/wiki/Acceptance_test-driven_development) — per-item acceptance criteria vs. blanket Definition of Done.
- ["From Confident Closing to Silent Failure" (arXiv html/2606.09863)](https://arxiv.org/html/2606.09863), ["LLM-as-a-Judge Is Not an Oracle" (arXiv pdf/2609.02246)](https://arxiv.org/pdf/2609.02246) — LLM verifiers rubber-stamp confident assertion language and mistake read-only tool calls for evidence of completion (AUROC as low as 0.54); execution-based verification is the strongest documented mitigation (~45% → ~3% false-success rate) — this is why `plan-verifier` must run real commands, not just read.

**Informing `doc-writer`:**
- [Diátaxis](https://diataxis.fr/) — Tutorial/How-to/Reference/Explanation framework; "describe an implemented feature" maps to Reference, "explain a decision" to Explanation.
- [adr.github.io](https://adr.github.io/), [Nygard, 2011 — Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) — numbered, sequential, immutable ADRs; a reversal supersedes, never rewrites.
- [passo.uno — Docs-as-code topologies](https://passo.uno/docs-as-code-topologies/) — sidecar vs. specialized docs topology; this repo is sidecar already.
- [Mintlify — When and how to use diagrams](https://mintlify.com/library/when-and-how-to-use-diagrams) — a diagram earns its place only for genuinely hard-to-express structure; diagrams-as-code avoid staleness because they're reviewed in the same PR as the change they depict.
