# Smart Diff (Files changed tab)

## Goal
On the PR "Files changed" tab, group files by role (core, tests, wiring, docs, boilerplate) instead of GitHub order. After a review runs, surface findings inline: per-group counts, a per-file red dot, auto-expanded files, and a FindingCard under the anchored line. A "Smart order | Original order" toggle switches back to the flat list. The work is client-only, with no server or contract changes.

## Context
- Affected modules: `client/` only. `server/`, `reviewer-core/` and the shared contracts are untouched. `e2e/` is checked for order dependencies (see Risks).
- Relevant existing code (all read):
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx`: renders `SectionLabel` ("Files changed · N files") and `<DiffViewer files commenting />`. Props are `prId, filesCount, files, canComment`.
  - `client/src/app/repos/[repoId]/pulls/[number]/page.tsx:72-77`: `allFindings = runs.flatMap(r => r.findings)`, memoized on `[reviews]`. DiffTab is rendered at ~L164-170 and does not receive findings yet. `repoFullName` and `pr.head_sha` are available there.
  - `client/src/components/diff-viewer/DiffViewer/DiffViewer.tsx`: flat `files.map(FileCard)` with `key={i}`.
  - `client/src/components/diff-viewer/FileCard/FileCard.tsx`:
    - `open` state is initialised from `AUTO_EXPAND_MAX_LINES` (200) in `constants.ts`.
    - It builds `lines = parsePatch(file.patch)`, `matched`/`outdated` comment threads, and renders `CodeLine` per line.
    - `OutdatedComments` is the pattern for the fallback block.
  - `client/src/components/diff-viewer/CodeLine/CodeLine.tsx`: the row is `lineRowFor(kind)`, followed by comment threads and the composer inside `cs.rowWrap`.
  - `client/src/components/diff-viewer/helpers.ts`: `parsePatch` returns `Line{kind,text,oldNo,newNo}`. RIGHT-side line numbers are `newNo` on `add` and `ctx` lines.
  - `client/src/components/diff-viewer/styles.ts` (inline-style objects `s`), `index.ts` (public surface: `DiffViewer`, `DiffCommentApi`), `comments.ts` (`DiffCommentApi`, `keysForLine`, and so on).
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/{FindingCard.tsx,constants.ts,index.ts}`:
    - Props are `f, focused, defaultExpanded, onAction, pending, repoFullName, headSha`.
    - `constants.ts` exports `SEV_COLOR` (CRITICAL/WARNING/SUGGESTION/INFO mapped to `--crit/--warn/--sugg/--info`) and `SEV_COLOR_FALLBACK`.
    - It reads `accepted_at`/`dismissed_at` and mutes itself when either is set.
  - `FindingsPanel.tsx`: the usage pattern is `useFindingAction()` and `action.mutate({ findingId, action, prId })`.
  - `client/src/lib/hooks/reviews.ts:139`: `useFindingAction` invalidates `["reviews", prId]` on success.
  - `@devdigest/shared` `FindingRecord`: `start_line`, `end_line`, `file`, `severity`, `accepted_at`, `dismissed_at` (`client/src/vendor/shared/contracts/review-api.ts:15`).
  - `client/messages/en/shell.json` has a `diffViewer` namespace (`noDiffText`, `noChangedFiles`, comment strings). `prReview.json` holds the finding strings.
  - localStorage precedent: `client/src/lib/repo-context.tsx:31`, `client/src/lib/theme.tsx:26` (keys prefixed `dd-`).
- Relevant skills:
  - `frontend-architecture`: colocate by default. Shared code must not import from `app/`. No new barrels inside the app. Pure logic goes in helper modules, not component bodies. Tests sit next to the file they cover.
  - `react-best-practices`: derive, don't store. Compute groups with `useMemo`. Don't add `renderX()` functions that return JSX (see the render-prop decision below). Keep components under 200 lines.
  - `react-testing-library`: a few flow-style tests, `userEvent`, query by role/text, mock only at boundaries.
  - `typescript-expert`: use a literal-union `FileRole` type and exhaustive maps.
- Constraints / gotchas:
  - `client/CLAUDE.md`: all copy in `messages/en/`. Feature logic lives in colocated folders with their own tests. `src/vendor/**` is not patched in place.
  - Root `CLAUDE.md`: do not touch lock files or migrations. No git commits.
  - `client/insights.md`: `@devdigest/ui` `Badge` has no `title` prop (wrap it in a `<span title>`). Count `../` depth carefully in deep relative imports. Prefer `@/` aliases where the neighbouring code uses them.
  - `@devdigest/ui` has no `SegmentedControl` (`Tabs` is an underline tab bar; there are no matches for "Segmented" under `src/vendor/ui`). Build a small local one and do not patch the vendor dir.
  - Severity vocabulary: the data uses CRITICAL/WARNING/SUGGESTION/INFO. The mockup's "blocker" maps to CRITICAL.

## Architecture decisions
- **Pure classifier** `classifyFile(path): FileRole` in `components/diff-viewer/classify.ts`. Check order is boilerplate, test file names (`*.test.*`/`*.spec.*`), docs, test directories, wiring, core, matching the agreed rules. `groupFiles(files)` does a stable bucket by role and keeps GitHub order inside each group. Both are framework-free and easy to unit-test (`frontend-architecture`: plain function over hook).
- **Findings mapping** is a pure `mapFindingsToFiles` helper in `components/diff-viewer/findings.ts`. It filters out dismissed findings and keeps accepted ones. Its result type is `Map<path, FindingRecord[]>`, and it also supplies per-file counts. Anchoring is RIGHT side only: a finding attaches to a line if a parsed `add`/`ctx` line has `newNo === start_line`. Otherwise it goes to the file's fallback list, which is never dropped.
- **Shared to page boundary:** `diff-viewer` is shared and must not import from `pulls/[number]/_components`. DiffTab therefore passes `renderFinding?: (f: FindingRecord) => React.ReactNode` down through `DiffViewer` to `FileCard` to `CodeLine`. `react-best-practices` warns against camelCase JSX factories, so the prop is a render callback only. DiffTab implements it as a small PascalCase `DiffFinding` component that calls `useFindingAction` and renders `<FindingCard defaultExpanded ...>`, and the callback returns `<DiffFinding f={f} />`.
  - `DiffViewer` keeps working when the prop is absent, with no findings UI.
  - SEV_COLOR for the severity bar and badge lives in the page-side card. The shared viewer needs the colour too, so it takes a `severityColor` from the render output or a `SEV_COLOR`-shaped constant. To avoid a shared to app import, add a tiny `diff-viewer` `constants.ts` map (`CRITICAL/WARNING/SUGGESTION/INFO` mapped to the same CSS vars). The implementer should note the duplication in a comment. Do not import from `FindingCard/constants`.
- **Toggle:** a local `SegmentedToggle` colocated in `components/diff-viewer/`, or in DiffTab's folder if only DiffTab uses it (colocate first). It uses `role="radiogroup"`/`radio` buttons. The state hook `useSmartOrder()` lives in the DiffTab folder. It reads localStorage in an effect, or via lazy init behind a `typeof window` guard, so SSR/hydration does not mismatch. Reads and writes are wrapped in try/catch. The default is smart, and the key is `dd-diff-order`.
- **Group UI:** a new `FileGroup` component (header with a coloured square, label, description, "N files", and the red-dot findings count) renders its `FileCard`s. Docs and boilerplate start collapsed. Empty groups render nothing.
- **FileCard changes:**
  - Optional props `findings`, `renderFinding`, `autoExpandOnFindings`.
  - A red dot in the header when the file has open findings.
  - `open` initial state is `true` if there are findings. Also handle findings arriving after mount with a "derive, don't sync" approach (see Risks).
  - CodeLine renders anchored findings under the row and adds a left severity bar and a severity badge at the end of the line.
  - A fallback block at the file bottom lists unanchored findings.
- **i18n:** add keys under `shell.diffViewer.*` for group labels, descriptions, "N files", the toggle labels ("Smart order"/"Original order"), and the fallback block title. Use ICU plurals for file counts.

## Tasks
- [ ] `[frontend]` Add `classifyFile` + `FileRole` + `groupFiles` (stable, ordered core, tests, wiring, docs, boilerplate) — `client/src/components/diff-viewer/classify.ts` (implementer-frontend)
- [ ] `[frontend]` Add `mapFindingsToFiles` and per-file anchor resolution: filter dismissed, RIGHT side `start_line` to a parsed line, fallback list for unanchored — `client/src/components/diff-viewer/findings.ts` (implementer-frontend)
- [ ] `[frontend]` Add severity colour map for the shared viewer — `client/src/components/diff-viewer/constants.ts` (implementer-frontend)
- [ ] `[frontend]` Add i18n keys (group labels/descriptions, files count plural, toggle labels, fallback title) — `client/messages/en/shell.json` under `diffViewer` (implementer-frontend)
- [ ] `[frontend]` Extend `FileCard` with the findings props: red dot, auto-expand, `renderFinding` passthrough, fallback block (new `UnanchoredFindings` component modelled on `OutdatedComments`) — `client/src/components/diff-viewer/FileCard/FileCard.tsx` (implementer-frontend)
- [ ] `[frontend]` Extend `CodeLine` to render anchored findings under the row, plus the left severity bar and end-of-line severity badge — `client/src/components/diff-viewer/CodeLine/CodeLine.tsx`, `styles.ts` (implementer-frontend)
- [ ] `[frontend]` Add `FileGroup` component (header, collapse state, red-dot count, "N files"); docs and boilerplate collapsed by default — `client/src/components/diff-viewer/FileGroup/FileGroup.tsx` (+ `index.ts` following the existing per-folder pattern) (implementer-frontend)
- [ ] `[frontend]` Update `DiffViewer` to accept `findings`, `renderFinding` and `order: "smart" | "original"`. Smart renders `FileGroup`s and original renders the flat list as today. Use stable keys (`file.path`) — `client/src/components/diff-viewer/DiffViewer/DiffViewer.tsx`; export any new public types in `client/src/components/diff-viewer/index.ts` (implementer-frontend)
- [ ] `[frontend]` Add `SegmentedToggle` and the `useSmartOrder` localStorage hook (try/catch, default smart) — colocated in `DiffTab/` (implementer-frontend)
- [ ] `[frontend]` Wire DiffTab: new `findings`, `repoFullName`, `headSha` props, the toggle next to the "Files changed · N files · +X −Y" header, a `DiffFinding` component using `useFindingAction` + `FindingCard` — `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx` (implementer-frontend)
- [ ] `[frontend]` Pass `allFindings`, `repoFullName` and `pr.head_sha` into `<DiffTab>` — `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` (~L164) (implementer-frontend)
- [ ] `[test]` `classify.test.ts`: table-driven role cases (lock files, `*.snap`, `__snapshots__`, `*.generated.*`, `generated/`, `*.min.*`, `dist/`, `*.test.*`, `*.spec.*`, `test/`, `tests/`, `__tests__/`, `e2e/`, `*.md(x)`, `docs/`, `LICENSE`, barrels, `*.config.*`, `package.json`, `tsconfig*`, `.env*`, `Dockerfile`, CI yaml, default core), precedence conflicts (for example `docs/x.test.ts` is tests, `dist/index.ts` is boilerplate), and `groupFiles` stability and order — `client/src/components/diff-viewer/classify.test.ts`
- [ ] `[test]` `findings.test.ts`: dismissed hidden, accepted kept, RIGHT-side anchor matching, out-of-patch line goes to fallback, file with no patch goes to fallback, counts per file — `client/src/components/diff-viewer/findings.test.ts`
- [ ] `[test]` `DiffViewer.test.tsx` (RTL flow tests; wrap in `NextIntlClientProvider` using `messages/en`, following the existing tests' setup): group order and headers, empty groups hidden, docs/boilerplate collapsed, header findings counter, file card dot, finding rendered under its line via a stub `renderFinding`, fallback block, "Original order" toggle gives the flat GitHub order — `client/src/components/diff-viewer/DiffViewer/DiffViewer.test.tsx`
- [ ] `[test]` `DiffTab.test.tsx`: localStorage persistence and try/catch (a throwing `localStorage` must not crash), default smart, and Accept on an inline FindingCard calls `useFindingAction` (mock `@/lib/hooks/reviews`, as `FindingsPanel.test.tsx` does) — `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.test.tsx`
- [ ] `[test]` Check `e2e/specs/05-pr-diff.flow.json` still holds under smart order (see Risks). Only update it if needed, and prefer a text-based wait — `e2e/specs/05-pr-diff.flow.json`, `e2e/README.md` L100 (implementer-frontend or test-writer)

## Sequencing & parallelization
1. No migration or shared-contract tasks exist. Everything is in `client/`.
2. Land first, since everything else depends on them: `classify.ts`, `findings.ts`, the severity constants, and the i18n keys. `classify.test.ts` and `findings.test.ts` can be written in parallel with the components (they need only the pure modules).
3. Then, in order: `FileCard` and `CodeLine`, then `FileGroup`, then `DiffViewer`, then `SegmentedToggle`/`useSmartOrder`, then `DiffTab` and `page.tsx`. `FileCard`/`CodeLine` and `FileGroup`/toggle touch different files and could be parallel, but a single implementer-frontend doing them in this order is simplest since the props chain is shared.
4. `DiffViewer.test.tsx` and `DiffTab.test.tsx` follow once the props contract is fixed (`findings`, `renderFinding`, `order`). The test-writer can start from the prop signatures above.
5. No `[backend]` tasks, so there is nothing to fan out.

## Risks / open questions
- **e2e ordering:** the only Files-changed flow is `e2e/specs/05-pr-diff.flow.json`. It waits for the text `src/config.ts` and does not click anything or depend on order. Under smart order `src/config.ts` does not match `*.config.*` (there is no dot before "config"), so it classifies as core and is expanded and visible. The wait should still pass. If the seeded PR ever puts it in docs or boilerplate (collapsed), the file header is still rendered, because only the body collapses. If a group is fully collapsed and headers are hidden, the wait would fail, so keep file headers visible inside expanded groups and groups themselves visible. Run the hermetic suite (`./scripts/e2e.sh`) to confirm; the plan cannot verify it without running it. No other flows reference the diff (grep of `e2e/` found only that spec and the README row).
- **Auto-expand after a run finishes:** `FileCard`'s `open` is `useState` initialised once. When findings arrive later (after Run review), the initial value won't update. Options: a `key` that includes "hasFindings", or an effect that opens the card once when findings appear (a legitimate external-data sync, but it must not re-open after the user collapses it). Pick one and cover it in the DiffViewer test. Open question: is it acceptable that a user's manual collapse is preserved after later refetches (for example after Accept/Dismiss invalidation)? The plan assumes yes.
- **Dismissed findings vanish on Dismiss:** dismissing invalidates `["reviews", prId]`, and the finding is then filtered out, so the card disappears. This is expected behaviour per the decisions, but the implementer should confirm the UX is acceptable.
- **`FindingCard` card-on-code-line layout:** the card is designed for a full-width list. Inside a `fileBody` with `padding: 8px 0` it may need a small wrapper with horizontal margin. Styling details from the mockup were not available to the planner, so check visually.
- **Same finding on several runs:** `allFindings` spans all runs, so duplicates of the same issue from different runs will all show. This matches the decision ("all open findings across all runs") but may look noisy.
- **Hydration:** reading localStorage during the initial render would mismatch SSR. Read it in an effect and accept a brief flash of the default order.
- **`kind: lethal_trifecta` findings** (`page.tsx:76`) are part of `allFindings`. Confirm they carry file/line data. If not, they land in the fallback block, or need a guard.
- **Severity naming:** the mockup says "blocker", the data says CRITICAL. The plan maps CRITICAL to the blocker styling and shows the existing `SeverityBadge` label.
- **Shared to app import rule:** the duplicated severity colour map is a deliberate trade-off. Alternative: move `SEV_COLOR` up to `src/lib/` and import it from both places. That is a bigger change to the existing FindingCard imports, so it is left as an optional cleanup.
- Out of scope: the per-file "summary" badge and the "What this does" block.

## Acceptance criteria
- With smart order (the default), files appear grouped core, tests, wiring, docs, boilerplate. Each group header shows a coloured square, label, description and "N files". Empty groups are hidden. Docs and boilerplate are collapsed by default, and lock files land in boilerplate. Order inside a group matches GitHub order.
- After a review, group headers show a red dot with the count of files that have findings, next to "N files". Files with findings show a red dot on their card and auto-expand. The finding is rendered under its RIGHT-side `start_line` as a `FindingCard` with working Accept/Dismiss. A left severity bar and a severity badge appear on the line. Findings whose line is not in the patch appear in a fallback block at the bottom of the file. Accepted findings stay visible (muted) and dismissed ones are hidden.
- The "Smart order | Original order" toggle sits next to the "N files" header. Original gives today's flat list. The choice persists in localStorage under `dd-diff-order` and survives reload, and a throwing localStorage does not break the tab.
- No hardcoded user-facing copy in new components (all in `messages/en/shell.json`). `components/diff-viewer` has no imports from `app/`.
- `cd client && pnpm typecheck && pnpm test` pass, including `classify.test.ts`, `findings.test.ts`, `DiffViewer.test.tsx` and `DiffTab.test.tsx`.
- `e2e/specs/05-pr-diff.flow.json` still passes under `./scripts/e2e.sh`.
- No lock files, migrations, vendor dirs, `server/` or `reviewer-core/` files are modified, and no commits are made.
