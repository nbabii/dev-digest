# Worked Example

A generic feature-based layout (what `frontend-architecture` describes in
the abstract), followed by how the same decisions map onto this repo's
actual `client/` tree.

## Generic Feature-Based Tree

```
src/
├── app/                      # composition root: router, providers, layout
├── components/                # shared, business-logic-free UI (Button, Card, Badge)
├── hooks/                     # shared hooks used by 2+ features (useDebounce, useMediaQuery)
├── lib/                       # preconfigured 3rd-party wrappers (api client, query client)
├── types/                     # shared/global TS types (API DTOs, cross-feature shapes)
├── utils/                     # shared pure helpers (formatDate, groupBy) — promoted, not duplicated
└── features/
    ├── repo-import/
    │   ├── api/                # useImportRepo(), useRepoStatus() — this feature's requests only
    │   ├── components/         # ImportForm, ImportProgress — used only here
    │   ├── model/              # validateRepoUrl(), parseCloneError() — pure domain logic
    │   ├── types/               # ImportJob, ImportStatus — local to this feature
    │   └── utils/               # feature-local helper, not yet needed elsewhere
    └── pr-review/
        ├── api/
        ├── components/
        ├── model/
        └── types/
```

**Why this shape, not a flat `components/` + `utils/` for everything:**
`repo-import` and `pr-review` never import each other. If both ever need
the same helper (say, a duration formatter), *that's* the moment it moves
to top-level `utils/` — not before. Until then, two small, slightly
different-looking helpers in two feature folders are cheaper to maintain
than one shared helper with a `mode: 'import' | 'review'` flag threaded
through it.

## Mapped Onto `client/` (this repo)

This repo uses Next.js's colocation variant of the same model — routes
replace the `features/` folder, since a route already is the feature
boundary:

```
client/src/
├── app/
│   ├── repos/
│   │   ├── page.tsx
│   │   └── _components/
│   │       ├── RepoList/
│   │       │   ├── RepoList.tsx        # feature-local component
│   │       │   ├── RepoList.test.tsx   # colocated test
│   │       │   └── useRepoFilters.ts   # feature-local hook (business logic)
│   │       └── ImportDialog/
│   └── agents/
│       └── _components/AgentEditor/
├── components/
│   ├── app-shell/                       # cross-route chrome — genuinely shared
│   └── diff-viewer/                     # used by both repos/ and agents/ review flows → promoted
├── lib/
│   ├── api.ts                           # every API call goes through here (see client/CLAUDE.md)
│   └── hooks/                           # shared query hooks (useRepos, useFindings)
└── vendor/
    ├── ui/                               # @devdigest/ui — vendored, patch upstream not in place
    └── shared/                           # @devdigest/shared
```

Decisions this reflects:

- `diff-viewer` started inside `repos/_components/` and was promoted to
  `src/components/` only once `agents/`'s review flow needed the identical
  component — the second-use rule from SKILL.md in practice.
- `useRepoFilters` stays inside `RepoList/` because only `RepoList` uses it;
  moving it to `src/lib/hooks/` "for consistency" would be a premature
  promotion with one consumer.
- Nothing in `app/repos/` imports from `app/agents/` or vice versa — any
  data both need flows through `src/lib/api.ts`, not a direct import
  between the two route trees.
