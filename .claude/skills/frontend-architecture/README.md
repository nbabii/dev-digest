# Frontend Architecture Skill — Sources

All sources used to research and build this skill (`SKILL.md`, `examples.md`),
organized by topic. Consult these directly for more depth than the skill
body carries.

## Feature-Based & Layered Project Structure

- **Bulletproof React — Project Structure**: https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md
  Top-level folders, feature folder anatomy (`api`/`components`/`hooks`/`stores`/`types`/`utils`), unidirectional `shared → features → app` import rule, and the argument against barrel files for tree-shaking.
- **Bulletproof React — Project Standards**: https://github.com/alan2207/bulletproof-react/blob/master/docs/project-standards.md
- **Feature-Sliced Design — Overview**: https://feature-sliced.design/docs/get-started/overview
  The seven layers (`app`/`processes`/`pages`/`widgets`/`features`/`entities`/`shared`), slices, segments (`ui`/`api`/`model`/`lib`/`config`), and the "import only from a layer strictly below" rule.
- **Feature-Sliced Design — Welcome**: https://feature-sliced.design/
- **Redux — Style Guide**: https://redux.js.org/style-guide/
  Official recommendation to structure by feature folder ("ducks" pattern) over folder-by-type (`actions/`, `reducers/`, `constants/`).
- **Redux — Code Structure FAQ**: https://redux.js.org/faq/code-structure

## Colocation & Promotion Rules

- **Kent C. Dodds — Colocation**: https://kentcdodds.com/blog/colocation
  Core principle: place code as close to where it's relevant as possible; move to a shared location only when genuinely used by more than one consumer.
- **Kent C. Dodds — State Colocation Will Make Your React App Faster**: https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster
- **Robin Wieruch — React Folder Structure Best Practices [2026]**: https://www.robinwieruch.de/react-folder-structure/
  Structure progression from single file → component-based → technical folders → feature-based → monorepo; the "promote to shared once two features need it" rule; naming conventions.
- **Next.js — Project Structure (official docs)**: https://nextjs.org/docs/app/getting-started/project-structure
- **Next.js — Routing: Colocation (official docs)**: https://nextjs.org/docs/14/app/building-your-application/routing/colocation
  Safe colocation of non-routing files inside `app/`, private folders (`_folderName`) for implementation details.

## Avoiding Duplication / Premature Abstraction

- **Kent C. Dodds — AHA Programming (Avoid Hasty Abstractions)**: https://kentcdodds.com/blog/aha-programming
  Why extracting an abstraction on the first duplication is often worse than waiting; the middle ground between DRY and WET.
- **Sandi Metz — The Wrong Abstraction**: https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction
  "Duplication is far cheaper than the wrong abstraction" — how a shared helper accumulates flags/conditionals to serve callers it was never designed for, and why re-inlining and deleting is the fix.

## Component Breakdown & Design Systems

- **React (official) — Thinking in React, Step 1**: https://react.dev/learn/thinking-in-react
  Heuristics for splitting UI into components: match the data model, single responsibility, and design-layer boundaries.
- **Brad Frost — Atomic Design**: https://bradfrost.com/blog/post/atomic-web-design/
- **Brad Frost — Atomic Design Methodology (ch. 2)**: https://atomicdesign.bradfrost.com/chapter-2/
  Atoms → molecules → organisms → templates → pages, as vocabulary for a shared design-system layer, not a mandate for feature-code folders.

## Barrel Files

- **Atlassian Engineering — How We Achieved 75% Faster Builds by Removing Barrel Files**: https://www.atlassian.com/blog/atlassian-engineering/faster-builds-when-removing-barrel-files
  Real-world case study on barrel-file build/memory cost at scale.
- **ReactUse — Barrel Files: Why index.ts Re-Exports Hurt Tree Shaking, Next.js Dev Memory, and tsc (2026)**: https://reactuse.com/blog/barrel-files-tree-shaking/

## Repo-Specific Context (not external, but shaped `examples.md`)

- `client/CLAUDE.md` — this repo's existing colocation convention (`_components/<Name>/` next to each route, shared `src/lib/api.ts` + `src/lib/hooks/*`).
