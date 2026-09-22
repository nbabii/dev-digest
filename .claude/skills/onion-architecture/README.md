# Onion Architecture Skill — Sources

All sources used to research and build this skill (`SKILL.md`,
`examples.md`), organized by topic. Consult these directly for more depth
than the skill body carries.

## Canonical Onion / Clean / Hexagonal Architecture

- **Jeffrey Palermo — The Onion Architecture: Part 1**: https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/
  The original 2008 post that coined the term — the app built around an independent object model, inner layers define interfaces, outer layers implement them, all coupling points toward the center.
- **Jeffrey Palermo — Onion Architecture: Part 4 – After Four Years**: http://jeffreypalermo.com/blog/onion-architecture-part-4-after-four-years/
  Palermo's own retrospective and clarifications.
- **Jeffrey Palermo — "onion-architecture" tag index**: https://jeffreypalermo.com/tag/onion-architecture/
  Full series index.
- **Herberto Graça — Ports & Adapters Architecture**: https://herbertograca.com/2017/09/14/ports-adapters-architecture/
  Cockburn's hexagonal model explained — the direct ancestor Onion builds on.
- **Herberto Graça — PEAA.1: Layering**: https://herbertograca.com/2016/06/27/peaa-1-layering/
  The foundational layering concept underlying Onion/Clean/Hexagonal alike.
- **Milan Jovanović — Clean vs Onion vs Hexagonal Architecture**: https://milanjovanovic.tech/blog/clean-architecture-vs-onion-vs-hexagonal
  Clarifies the three are near-synonyms sharing "dependencies point inward"; differ mainly in terminology/rigor — the source this skill cites for treating them as one family.
- **Oliver Drotbohm — Sliced Onion Architecture**: http://odrotbohm.github.io/2023/07/sliced-onion-architecture/
  Modern reinterpretation combining Onion's rings with vertical feature slices — directly relevant since DevDigest's `modules/<name>/` are already feature-sliced, not ring-sliced.

## Node.js / TypeScript-Specific Adaptations

- **Khalil Stemmler — Better Software Design with Application Layer Use Cases**: https://khalilstemmler.com/articles/enterprise-typescript-nodejs/application-layer-use-cases/
  Domain layer (entities/value objects) vs application layer (use cases, orchestration) in TypeScript.
- **Khalil Stemmler — Implementing DTOs, Mappers & the Repository Pattern**: https://khalilstemmler.com/articles/typescript-domain-driven-design/repository-dto-mapper/
  Repository interfaces in the domain layer, ORM-backed implementations in infrastructure, mapping between the two — the source behind this skill's `RepoSummary` DTO example.
- **Remo Jansen — Implementing the Onion Architecture in Node.js with TypeScript and InversifyJS**: https://dev.to/remojansen/implementing-the-onion-architecture-in-nodejs-with-typescript-and-inversifyjs-10ad
  Layer-by-layer Node/TS example with a DI framework — useful contrast since DevDigest uses a hand-rolled `Container` class instead.
- **Alex Rusin — Clean Architecture in Node.js: Repository Pattern with TypeScript and Prisma**: https://blog.alexrusin.com/clean-architecture-in-node-js-implementing-the-repository-pattern-with-typescript-and-prisma/
  Repository interface in domain, ORM-backed class in infrastructure — ORM-adjacent (Prisma, not Drizzle) but directly transferable.

## Fastify-Specific DI/Plugin Architecture

- **Fastify docs — Encapsulation**: https://fastify.dev/docs/latest/Reference/Encapsulation/
  The plugin/context tree — children inherit from parents, parents can't reach into children. Fastify's native mechanism for scoping adapters/ports per module.
- **Fastify docs — Decorators**: https://fastify.dev/docs/latest/Reference/Decorators/
  `decorate`/`decorateRequest`/`decorateReply` as the idiomatic way to attach services/ports without a DI framework — the pattern `Container` already follows.
- **Fastify docs — The Hitchhiker's Guide to Plugins**: https://fastify.dev/docs/latest/Guides/Plugins-Guide/
  Frames Fastify's own plugin system as "a lightweight dependency injection system."
- **fastify/fastify-plugin (GitHub)**: https://github.com/fastify/fastify-plugin
  The wrapper used to deliberately break encapsulation when a decorator must be visible outside its own scope.

## Repository Pattern / ORM Boundary

- **Sentry Engineering — Atomic Repositories in Clean Architecture and TypeScript**: https://blog.sentry.io/atomic-repositories-in-clean-architecture-and-typescript/
  Repository interface as a domain-layer port, concrete class as an infrastructure-layer adapter; transaction/atomicity handling across repositories.
- **Repository Pattern in Nest.js with Drizzle ORM**: https://medium.com/@vimulatus/repository-pattern-in-nest-js-with-drizzle-orm-e848aa75ecae
  Wraps Drizzle queries per-resource in a repository module so route/service code never touches the query builder directly — one of the few sources naming Drizzle specifically.
- **Hassan Javed — Drizzle ORM in Production: Patterns I Use After 6 Client Projects**: https://www.hassanjaved.work/blog/drizzle-orm-patterns-production-2026
  Calls wrapping Drizzle in repositories "the single best architectural choice for keeping a Drizzle codebase maintainable past a year"; also covers not leaking Drizzle's inferred row types across the API boundary — the direct source for this skill's `$inferSelect` leak example.
- **Paul Serban — Drizzle ORM Best Practices**: https://paulserban.eu/blog/post/drizzle-orm-best-practices-principles-patterns-and-real-world-case-studies/
  Broader Drizzle best-practices piece, including repository-style organization.
- **dev.to (fyapy) — Repository Pattern with TypeScript and Node.js**: https://dev.to/fyapy/repository-pattern-with-typescript-and-nodejs-25da
  General, ORM-agnostic repository-pattern walkthrough.

Note: dedicated Drizzle + Onion/Clean/Hexagonal writing is thin — it's a
newer ORM. The two sources above that name Drizzle directly are the
strongest fit; the rest of this section is general TypeScript
repository-pattern content applied by analogy.

## Pragmatic Adoption / When to Skip Layers

- **Three Dots Labs — Is Clean Architecture Overengineering?**: https://threedots.tech/episode/is-clean-architecture-overengineering/
  Becomes overengineering for simple projects/small teams/trivial domains; recommends starting simple and letting architecture evolve with genuine complexity — "the goal is not using any kind of architecture... but to use something that helps teams code faster."
- **Learnixo — When NOT to Use Clean Architecture**: https://learnixo.io/blog/clean-arch-when-not-to-use
  Concrete anti-cases: small CRUD APIs, prototypes/short-lived apps, where the layering tax (setup time, per-use-case boilerplate, onboarding cost) isn't repaid.

## Repo-Specific Context (not external, but shaped SKILL.md/examples.md)

- `server/CLAUDE.md`, `reviewer-core/CLAUDE.md` — existing module maps and stack notes.
- `server/src/vendor/shared/adapters.ts` — the ports already defined (`LLMProvider`, `GitHubClient`, `GitClient`, `SecretsProvider`, `CodeIndex`, `Embedder`).
- `server/src/platform/container.ts` — the existing composition root this skill treats as DevDigest's DI mechanism.
- `server/src/modules/reviews/repository.ts`, `server/src/db/rows.ts` — the real `$inferSelect` leak this skill's examples are built from.
