---
name: frontend-architecture
description: "UI architecture and code organization for React/Next.js frontends — where components, constants, utils/helpers, business logic, types, and state live, how to lay out feature folders, and how to avoid duplicating logic across the codebase. Use when scaffolding a new feature, deciding where a file or piece of logic should go, restructuring/refactoring folders, or reviewing a PR for organization/placement issues. This is about WHERE code lives and folder-level architecture — for HOW to write a component, hook, or piece of state (component design, hooks rules, memoization, a11y), use react-best-practices instead; for Next.js routing/file conventions, use next-best-practices. Always consult before creating a new top-level folder or a new feature module."
version: 1.0.0
---

# Frontend / UI Architecture

Rules for organizing frontend code so a project stays navigable as it grows,
and so the same logic doesn't get reinvented in three different features.
Covers layout of the codebase, not the internals of any one component — see
[examples.md](examples.md) for a worked folder tree and
[README.md](README.md) for every source this skill is built from.

## Two Structural Models

Pick one per project, don't mix ad hoc.

| Model | When | Core idea |
|---|---|---|
| **Feature-based** (default, e.g. Bulletproof React) | Most apps, small-to-mid teams | `features/<name>/` owns its own `api`, `components`, `hooks`, `stores`, `types`, `utils`. A thin top-level `shared` layer holds what's genuinely cross-feature. |
| **Feature-Sliced Design (FSD)** | Large apps, many teams, strict boundaries needed | Adds explicit layers (`app > pages > widgets > features > entities > shared`) with an enforced import rule: a module may only import from a layer strictly *below* it. Use when feature-based folders keep growing tangled import graphs. |

Both share the same underlying rule: **code that changes together lives
together, and dependencies only point one way.**

## In This Repo (client/)

DevDigest's `client/` already follows the Next.js colocation variant of the
feature-based model (see `client/CLAUDE.md`) — don't introduce a parallel
`src/features/` tree on top of it:

- Route-owned feature logic → colocated `_components/<Name>/` next to the
  page in `src/app/<route>/`, with its own `*.test.tsx`.
- Cross-route, reusable UI → `src/components/<name>/`.
- All API calls and query/mutation hooks → `src/lib/api.ts` + `src/lib/hooks/*`.
- Vendored design-system/shared packages → `src/vendor/ui`, `src/vendor/shared` (patch upstream, never in place).
- i18n strings → `src/i18n/` + `messages/en/`, never hardcoded in components.

Everything below still applies — just read "feature folder" as
`_components/<Name>/` and "shared" as `src/components|lib|hooks`.

## Import Direction (CRITICAL)

`shared → features → app`, one-way, always:

- Shared code (`components/`, `hooks/`, `lib/`, `types/`, `utils/`) can be
  imported by anything and imports nothing feature-specific.
- A feature can import shared code and its own files, never another
  feature's internals — only that feature's public surface (its top-level
  exports), never reaching into `features/other/hooks/useX` directly.
- Nothing under `shared/` or `features/` imports from `app/`.

Violating this is how "shared" folders quietly become a second copy of
every feature's logic.

## Where Does X Go?

| Thing | Default location | Promote to shared when |
|---|---|---|
| Component used by one feature/page | colocated with that feature/page | 2+ features need the same component |
| Generic, business-logic-free UI element (button, card, badge) | shared UI layer (`components/ui`, `@devdigest/ui`) | always — it never belonged to one feature |
| Constant specific to a feature's domain (labels, thresholds, enums) | top of the feature file, or `feature/constants.ts` if reused within the feature | 2+ features reference the same constant |
| App-wide config (API base URL, feature flags, env-derived values) | a single `config`/`lib` module, never scattered `process.env` reads | — (already global by nature) |
| Pure helper function (formatting, math, string/array manipulation) | `feature/utils` | 2+ features need the identical function → `utils/` |
| Business/domain logic (validation, calculations, decision rules tied to a domain concept) | a hook or `model`/`services` module the component calls — never inline in the component body | only extract the domain-agnostic part; don't promote a feature's whole rule set just because one function looks similar |
| API call + its cache hooks | `feature/api` (or this repo's `src/lib/api.ts` + `src/lib/hooks/*`) | a client/base config used everywhere → shared `lib/` |
| Cross-cutting global state (auth, theme, current user) | a single top-level store | — |
| Feature-local state | colocated in the component/feature, per the "derive, don't lift" rule in `react-best-practices` | promote only if 2+ features must share the *same* slice of state |
| Type describing a domain entity | colocated with the feature/entity that owns it | a DTO/shape crossing feature boundaries → shared `types/` |

The rule threading all of these: **colocate by default, promote on the
second real usage — never on the first.** See "Avoiding Duplication" below
for why the second-use threshold matters.

## Component Breakdown Heuristics

When splitting UI into components, use React's own decision criteria
(*Thinking in React*), in this order:

1. **Match the data model** — if your API/JSON response is well-structured,
   your components should mirror its shape one-to-one. This is the
   strongest signal; try it first.
2. **Single responsibility** — a component should be concerned with one
   thing. If it's doing two unrelated things, split it (same test you'd
   apply to a function).
3. **Design boundaries** — if a design system or Figma file already named
   layers, match that naming so design and code stay in sync.

Atomic Design (atoms → molecules → organisms → templates → pages) is a
useful *vocabulary* for a shared design-system layer (`components/ui`) —
don't force feature code into that hierarchy; it fights the data-model rule
above and adds indirection most features don't need.

## Business Logic Placement (CRITICAL)

- Business logic never lives in a component body — that's `react-best-practices`
  territory (components must be pure, side-effect-free). This skill only
  answers *where* the extracted logic should live.
- Extract to a hook (if it needs component lifecycle/state) or a plain
  function in a `model`/`services` module (if it doesn't — prefer this when
  possible, since plain functions are trivial to unit-test).
- A domain function should be framework-agnostic: no `useState`, no JSX, no
  DOM access. If it needs those, it's a hook, not a domain function.

## Avoiding Duplication

This is the reason feature-based structure exists — get it wrong and you
get the same validation rule reinvented in five features.

- **Colocate first, promote on the second use.** Code that lives inside one
  feature folder is cheap to change or delete. Code promoted to `shared/`
  becomes a dependency other features rely on — moving it back is a
  breaking change. Don't pay that cost until a second consumer actually
  exists.
- **Don't abstract on the first duplication.** Two similar-looking blocks of
  code are not automatically "the same logic" — they may just look alike
  today and diverge tomorrow. Wait for a third occurrence, or until the
  shared shape is unmistakable, before extracting (AHA programming: *Avoid
  Hasty Abstractions*, not DRY-at-all-costs).
- **A wrong shared abstraction is worse than duplication.** If a "shared"
  helper has grown boolean flags and `if (context === 'featureA')` branches
  to serve multiple callers, that's the wrong abstraction — inline it back
  into each caller and delete the flags, rather than adding a fourth one.
- **Don't reach into another feature to avoid writing a few lines.** That
  import is a hidden coupling, not reuse. Duplicate the few lines, or
  promote the shared part to `shared/` — never import feature-to-feature.

## Public API / Barrel Files (MEDIUM)

- Don't add `index.ts` barrel re-exports inside the app to make imports
  "tidy" — they defeat tree-shaking, slow down dev-server rebuilds and
  `tsc`, and cause circular-import bugs (`Cannot access 'X' before
  initialization`) as the barrel grows.
- Import directly from the file that defines the thing.
- Reserve a barrel for the one legitimate case: the public entry point of a
  package meant to be consumed from outside itself (e.g. `src/vendor/ui`,
  a published `@devdigest/*` package) — never for internal app code.

## Naming Conventions

- Files: kebab-case (`review-summary.tsx`), not PascalCase filenames.
- Feature/domain folders: singular (`repo/`, not `repos/`); plural only for
  genuine collections (`components/`, `hooks/`).
- One component per file; PascalCase for the exported component itself.
- Tests colocated next to the file they cover (`*.test.tsx`), never in a
  parallel `__tests__` tree that mirrors `src/`.

## See Also

- `react-best-practices` — component/hook internals, state patterns,
  memoization, a11y (the "how", once you know "where").
- `next-best-practices` — App Router file conventions, RSC boundaries,
  route-level data patterns.
- [examples.md](examples.md) — a worked folder tree with the reasoning
  behind each placement.
- [README.md](README.md) — every source this skill was built from.
