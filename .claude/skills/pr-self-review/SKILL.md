---
name: pr-self-review
description: "Pre-merge self-review gate that matches the local diff against this repo's own skills (frontend-architecture, onion-architecture, security, etc.) and blocks opening/merging a PR if any critical finding is found. Use manually via /pr-self-review before opening a PR, and automatically whenever a `gh pr create` call is about to run (wired via a PreToolUse hook) — never for a full deep-dive review of an already-open PR, that's /code-review."
version: 1.0.0
---

# PR Self Review

A fast, local pre-merge gate: before a PR leaves the machine, check the diff
against the domain skills already living in `.claude/skills/` and this
repo's own hard rules, and refuse to proceed if anything critical turns up.
This is not a replacement for `/code-review` (which does a full bug-hunt) —
it's a cheaper, mechanical pass scoped to *this repo's documented
conventions*, meant to catch violations a teammate (or `/code-review`) would
otherwise have to flag later, more expensively, in PR comments.

## When this runs

- **Manually**: `/pr-self-review`, any time.
- **Forced**: a `PreToolUse` hook (configured separately in
  `.claude/settings.json`, matching `Bash` calls whose command matches
  `gh pr create`) runs this skill before the command is allowed through. If
  this skill ends in `BLOCKED`, the hook denies the `gh pr create` call.
- **Known gap**: a PR opened via the GitHub web UI (no `gh pr create` call
  from this session) is not caught by the hook. Manual invocation is the
  fallback for that path — this is a deliberate v1 scope decision, not an
  oversight. A server-side gate (CI / branch protection) is explicitly out
  of scope for this skill.

## Step 0 — Determine the diff

```
git merge-base HEAD main
git diff <merge-base>...HEAD
```

Only the commits that would actually go into the PR — never uncommitted
working-tree noise, never the whole repo. If there's no diff against `main`,
say so and stop; there's nothing to review.

## Step 1 — Hard-rule check (always runs, no skill matching needed)

Independent of any domain skill, check the diff against root
[`CLAUDE.md`](../../CLAUDE.md)'s **Do not touch** list. Any hit here is
**critical** by itself:

- an existing file under `server/src/db/migrations/` was *modified* (a new
  migration file is fine; editing one already merged is not)
- `pnpm-lock.yaml`, `package-lock.json` was hand-edited rather than
  regenerated (diff touches the lockfile without a corresponding
  `package.json` change in the same commit range)
- a file under `client/src/vendor/` or `server/src/vendor/` was edited in
  place instead of patched upstream
- anything under `server/clones/` was committed (it's git-ignored — if it
  shows up in the diff, something is wrong)
- a secret-shaped value (matches patterns for API keys/tokens) was added
  outside `~/.devdigest/secrets.json` (which isn't in this repo at all) —
  i.e. hardcoded into source or committed to the DB seed

## Step 2 — Classify changed files by module

| Files touched | Module |
|---|---|
| `client/**` | Frontend |
| `server/**` | Backend |
| `reviewer-core/**` | Backend (pure pipeline) |
| `e2e/**` | Test suite |
| root config, `scripts/`, `.github/`, `docker-compose.yml` | Repo-wide |

A diff can span more than one row — classify by what's actually present,
don't force it into one bucket.

## Step 3 — Match applicable skills

Read the catalog in [`.claude/skills/README.md`](../README.md) for the
current skill list and their `Scope` column — that table is the source of
truth, don't hardcode a copy of it here that can drift out of date. Apply
it as:

| Module present in diff | Run all skills scoped | 
|---|---|
| Frontend | `Frontend` |
| Backend | `Backend` |
| *(any `.ts`/`.tsx` in the diff)* | `Full-stack` |

Skills scoped `Shared` (e.g. `mermaid-diagram`) or process/meta skills
(e.g. `engineering-insights`) are never run here — they're not review
lenses.

For each matched skill, trust its own `SKILL.md` description to decide
whether it actually has anything to say about the specific files changed
(e.g. `postgresql-table-design` only has findings if a migration or schema
file is in the diff, `react-testing-library` only if a test file is) —
don't invent a second, more granular glob table that duplicates what each
skill already documents about itself.

## Step 4 — Check module `insights.md` for repeat offenses

For each module touched (per Step 2), read that module's `insights.md`,
specifically the **Recurring Errors & Fixes** section. If the diff
reproduces a pattern documented there, flag it — this is typically a fast,
high-confidence finding since it's already been diagnosed once before.

## Step 5 — Run the review

For each skill matched in Step 3, load it and evaluate only the diff hunks
in its scope against its rules. Produce findings as:

- `file:line`
- one-sentence summary of the violation
- which skill/rule it came from
- severity (see rubric below)

## Severity rubric

Decided centrally here, not by each domain skill individually, so
"critical" means the same thing regardless of which skill raised it.

| Severity | Definition | Examples |
|---|---|---|
| **critical** | Blocks the PR. Security-exploitable, risks data loss/corruption, violates a root `CLAUDE.md` hard rule (Step 1), or breaks a hard architectural invariant. | Hardcoded secret, injection vector, editing an existing migration, a `server/` service importing a concrete adapter directly (onion-architecture dependency rule), a repository leaking a raw Drizzle row type across a layer boundary. |
| **major** | Real problem, doesn't block. Should be fixed before or shortly after merge. | Missing test for new logic, a component that should be split per `frontend-architecture`, a Fastify route missing schema validation. |
| **minor** | Style/consistency nit. | Naming, minor duplication, non-idiomatic but correct usage. |

When in doubt between critical and major, prefer major — this gate should
have a low false-positive-block rate; the cost of a wrongly blocked PR is
higher than a major finding slipping through to normal PR review.

## Step 6 — Aggregate and dedupe

Merge findings across skills keyed by `file:line`. If two skills flag the
same location (e.g. `security` and `onion-architecture` both flag a
hardcoded credential in an adapter), report it once, noting both sources.

## Step 7 — Verdict

End every run with an explicit, greppable verdict line — this is what a
headless invocation (from the `gh pr create` hook) keys off of to decide
whether to allow the command through:

```
PR_SELF_REVIEW_RESULT: PASS
```
or
```
PR_SELF_REVIEW_RESULT: BLOCKED (<n> critical)
```

Before the verdict line, print a human-readable summary grouped by
severity, then by skill, with `file:line` and the one-line explanation for
each finding. Major/minor findings are always shown (not blocking) so the
author can fix them before merge if they choose to.

## Non-goals

- Not a substitute for `/code-review` (bug-hunting) or `/code-review ultra`
  (deep multi-agent review) — this only checks the diff against this repo's
  own documented conventions, not general correctness.
- Not a CI/branch-protection gate — enforcement is local-only, tied to the
  `gh pr create` invocation in this session.
- Doesn't re-run on every `git push` — only at the point of opening the PR,
  to avoid friction on routine WIP pushes.
