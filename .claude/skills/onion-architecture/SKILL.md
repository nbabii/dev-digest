---
name: onion-architecture
description: "Onion/Clean/Hexagonal architecture rules for DevDigest's backend (server/, reviewer-core/) — the dependency rule (dependencies point inward only), where ports/interfaces vs their concrete adapters live, keeping Drizzle row types and Fastify types out of domain/application code, and how Zod contracts sit at the boundary vs domain invariants. Use when adding a module, service, repository, or adapter; defining a new port/interface; wiring something into the DI container; or reviewing a backend PR for layering violations (a service importing an adapter directly, a repository returning a raw Drizzle-inferred type, business logic living in a route handler). Not about frontend code — see frontend-architecture for client/. Not about Fastify plugin/route mechanics in general — see fastify-best-practices for that; this skill is about which layer code belongs in, not how to write a route."
version: 1.0.0
---

# Onion Architecture (Backend)

Rules for keeping `server/` and `reviewer-core/` organized around a
**dependency rule**: code that expresses business/domain logic must never
depend on code that talks to a database, an LLM API, GitHub, or HTTP —
those depend on the domain, never the other way around. See
[examples.md](examples.md) for a worked before/after from this repo's own
code, and [README.md](README.md) for every source this skill is built from.

## The Rings, Mapped to This Repo

Onion Architecture, Clean Architecture, and Hexagonal (Ports & Adapters) are
near-synonyms — same dependency rule, different vocabulary for the same
rings (see [README.md](README.md) for the source that untangles the three
names). This skill uses Onion's ring names because they map cleanly onto
what already exists here:

| Ring | What it is | Where it lives in this repo |
|---|---|---|
| **Domain model** | Entities/value objects, framework-free | `@devdigest/shared` contracts (`Review`, `Finding`, `Verdict`, …), `reviewer-core/`'s pure logic (`prompt.ts`, `grounding.ts`, `output/`) |
| **Ports** (interfaces) | Contracts the domain/application depends on, defined *inward*, implemented *outward* | `server/src/vendor/shared/adapters.ts` — `LLMProvider`, `GitHubClient`, `GitClient`, `SecretsProvider`, `CodeIndex`, `Embedder` |
| **Application services** (use cases) | Orchestrates domain + ports for one use case; no SQL, no HTTP, no `fetch` | `server/src/modules/<name>/service.ts` |
| **Infrastructure** (adapters) | Concrete implementations of ports | `server/src/adapters/*` (LLM, GitHub, git, ast-grep, secrets, tokenizer), `server/src/db/*` (Drizzle schema + queries) |
| **Delivery / entry** | Translates a transport (HTTP, CLI, CI) into a use-case call | `server/src/modules/<name>/routes.ts` (Fastify), the CI agent-runner |

`reviewer-core/` is already the cleanest example of this in the codebase:
zero DB/GitHub/FS access, the only side effect is an **injected**
`LLMProvider`. Treat it as the reference implementation when in doubt.

## The Dependency Rule (CRITICAL)

Dependencies point inward, always:

```
routes.ts  →  service.ts  →  ports (adapters.ts interfaces)  ←  src/adapters/*
  (delivery)   (application)      (domain-facing contract)      (infrastructure, implements the port)
```

- `modules/<name>/service.ts` may import types from `@devdigest/shared` and
  call methods on interfaces (`LLMProvider`, `GitHubClient`, a repository's
  own method signatures) — it must **never** import a class from
  `src/adapters/*` directly, and never import `drizzle-orm` or
  `src/db/schema.js` to build a query itself.
- `src/adapters/*` and `src/db/*` may depend on the ports they implement and
  on npm packages (`drizzle-orm`, `octokit`, `@anthropic-ai/sdk`, …) — they
  must never import from `modules/*/service.ts` (that would be an outward
  ring reaching back to an inner one, backwards).
- A repository's public methods return **domain-shaped data**, not whatever
  the ORM happens to infer. `server/src/modules/reviews/repository.ts`
  currently violates this — `getRepo()` returns
  `typeof t.repos.$inferSelect` (a raw Drizzle row type) straight out of the
  repository, and `PullRow`/`FindingRow` (`db/rows.ts` type aliases over
  `$inferSelect`) leak the same way. Don't propagate this pattern into new
  code — see [examples.md](examples.md) for the fix shape. Existing call
  sites don't need an emergency rewrite; new repository methods should
  return a purpose-shaped type instead of `typeof t.<table>.$inferSelect`.
- `reviewer-core/` must stay free of `server/`, Fastify, and Drizzle imports
  entirely — that boundary already holds; don't be the PR that breaks it.

## Fastify Is the DI Mechanism — Don't Add Another One

DevDigest has no DI framework (no InversifyJS, no tsyringe). The
composition root is `server/src/platform/container.ts` (`Container`): it
lazily constructs adapters behind getters, honors `ContainerOverrides` for
tests, and is handed to Fastify via a decorator. This **is** the Onion
composition root — Fastify's own plugin/encapsulation model plus one plain
class does the job a DI container would in a larger stack (see the Fastify
docs on Encapsulation/Decorators in [README.md](README.md)).

- A route handler constructs its service from `container` (`new
  ReviewService(container)`) and does nothing else business-shaped — no
  SQL, no LLM calls, no `if` branches encoding a business rule. Its job is
  parse request → call one service method → shape the HTTP response.
- Adding a new external dependency (a new LLM provider, a new GitHub call)
  means: 1) add/extend the port interface in `adapters.ts`, 2) implement it
  under `src/adapters/<kind>/`, 3) add a lazy getter on `Container`, 4)
  consume it from `service.ts` via `container.<thing>` — never
  `import { ConcreteThing } from '../../adapters/...'` inside a service.
- `ContainerOverrides` is what makes services unit-testable without a real
  DB/LLM/GitHub call — if a service reaches past `container` for a
  dependency, that override path breaks silently.

## Where Zod Validation Belongs

Two different jobs, two different layers — don't conflate them:

- **Boundary/delivery validation** (shape, types, required fields) — Zod
  schemas from `@devdigest/shared` (`src/vendor/shared/contracts/*`), wired
  as Fastify route schemas via `fastify-type-provider-zod`. This is
  delivery-ring concern: reject malformed input before it reaches a
  service.
- **Domain invariants** (business rules: "a review can't be accepted twice",
  "grounding must drop ungrounded findings") — plain TypeScript in the
  application/domain layer, not a Zod refinement bolted onto the transport
  schema. `reviewer-core/grounding.ts`'s mandatory citation gate is the
  model: it's a domain rule enforced in code, not a schema constraint.

If a validation rule only makes sense in HTTP-request terms (e.g. "id must
be present in the URL"), it belongs in the shared contract schema. If it
only makes sense in domain terms (e.g. "a finding without a diff citation
is invalid"), it belongs in domain/application code, independent of how
the request arrived.

## How Rigorous to Be (Pragmatic Adoption)

Don't force every module into four physical folders
(`domain/application/infrastructure/delivery`) — that's a real cost for a
small module, and Onion's own critics call this out (see [README.md](README.md),
Three Dots Labs and Learnixo). What DevDigest already has —
`routes.ts` / `service.ts` / `repository.ts` colocated per feature module —
is a fine *physical* layout. The rule this skill forces is **directional**,
not **physical**:

- Keep the existing per-module file layout (it mirrors
  `frontend-architecture`'s feature-based model on the client side — same
  idea, backend flavor).
- Enforce the *import direction* between those files (`routes → service →
  ports ← adapters`), not a folder reorganization.
- Reserve a full explicit ring split (separate `domain/` folder with
  entities distinct from DTOs, explicit use-case classes, etc.) for
  `reviewer-core/`-sized pieces: genuinely reusable, side-effect-free logic
  consumed by more than one delivery mechanism (server *and* the CI
  agent-runner, in this repo's case). A single CRUD-shaped module talking to
  one table doesn't need that ceremony — a clean `service.ts` that only
  calls its own `repository.ts` and injected ports already satisfies the
  dependency rule.

## Enforcing It: dependency-cruiser

`dependency-cruiser` is already a `server/` devDependency — today it's only
consumed as a library (`src/adapters/depgraph/`, to analyze *other* repos
for repo-intel). Point it at this repo's own `src/` to turn the dependency
rule above into a CI-checkable guardrail instead of a convention people
have to remember. See [examples.md](examples.md) for a starter
`.dependency-cruiser.cjs` with the two rules that matter most here:
`service.ts` may not import `src/adapters/**` directly, and nothing outside
`src/adapters/**`/`src/db/**` may import `drizzle-orm`.

## See Also

- [examples.md](examples.md) — the `ReviewRepository` leak fixed, a new
  port wired end-to-end, and the dependency-cruiser starter config.
- [README.md](README.md) — every source this skill was built from.
- `fastify-best-practices` — route/plugin mechanics (the "how" of a route,
  once you know it belongs in the delivery ring).
- `drizzle-orm-patterns` — schema/query mechanics (the "how" of an adapter,
  once you know persistence belongs in the infrastructure ring).
- `typescript-expert` — for interface/generics design once a port's shape
  gets non-trivial.
