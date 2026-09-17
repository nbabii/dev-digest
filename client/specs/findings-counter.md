# Findings counter — client

Two surfaces, one shared popover component:

1. A **Findings** column on the PR list, showing a per-severity count badge
   group + hover popover listing every open finding across the whole PR.
2. A per-row severity badge group + hover popover on the **Agent runs**
   timeline, scoped to that one run.

See `server/specs/findings-counter.md` for the counting rules (open =
undismissed; which runs count) and the `PrMeta.findings` API addition.

## Design mapping

| Badge | severity | icon/color (already defined in `tokens.ts`) |
|---|---|---|
| ⊘ red | `CRITICAL` | `AlertOctagon` / `--crit` |
| ⚠ orange | `WARNING` | `AlertTriangle` / `--warn` |
| 🔵 blue | `SUGGESTION` | `Lightbulb` / `--sugg` |

Zero-count tiers are hidden; an all-zero PR/run shows `—` (muted), matching
the "Bump node 18 → 20" / "Fix flaky checkout" rows in the design.

Popover list: sorted severity (critical→warning→suggestion) then confidence
desc, full scrollable list, no top-N truncation. Rows reuse the same
primitives as `FindingCard`'s collapsed header (`SeverityBadge compact +
CategoryTag + MonoLink(file:line) + ConfidenceNum`) plus a truncated
`rationale` snippet — read-only, no accept/dismiss/expand.

## Shared component

`client/src/components/findings-popover/` (new, sits alongside other
cross-page pieces like `run-cost-badge` — not colocated under a single page's
`_components/`, since both the PR-list and PR-detail pages need it):

- `FindingsPopover.tsx` — hover-triggered badge group + panel.
  - `counts: { CRITICAL: number; WARNING: number; SUGGESTION: number }` —
    eager, always known up front (from `PrMeta.findings` on the list, or
    computed locally on the Agent-runs tab).
  - `findings: FindingRecord[] | undefined` — the detailed list for the panel;
    `undefined` while not yet loaded (list page, lazy-fetched on hover) or
    always-provided (Agent-runs tab, already in memory).
  - `loadingFindings?: boolean`
  - `scope: "pr" | "run"` — picks the popover title copy.
  - `repoFullName?, headSha?` — for `MonoLink` → GitHub blob links.
  - Filters to open (`!dismissed_at`) internally before counting/rendering the
    panel list (the `counts` prop is trusted as already-open counts).
- `index.ts` barrel export.

Hover mechanics: `onMouseEnter`/`onMouseLeave` on the trigger toggle `open`
(120ms close delay so moving from trigger to panel doesn't flicker). Unlike
`@devdigest/ui`'s `Dropdown.tsx` (in-flow `position: relative` + `absolute`
panel), the panel here is rendered via `createPortal` into `document.body`
with `position: fixed`, positioned from the trigger's
`getBoundingClientRect()`. This was tried in-flow first and found broken in
practice: the PR list's `tableCard` (`overflow: hidden`) auto-sizes to its
rows, so an absolutely-positioned panel extending below a row gets clipped
almost immediately, not just "near the bottom of a long list" as originally
assumed — confirmed visually with a single-row table where the panel was cut
to a sliver. The same enter/leave handlers are attached to both the trigger
and the portaled panel, so hovering across the gap between them still counts
as "inside" (the open/close logic is timer-based, not DOM-containment-based,
so this works despite the two living in different subtrees).

## PR list wiring

- `pulls/constants.ts` — add `"findings"` to `COLUMN_KEYS` (between `score`
  and `status`), extend `GRID` with a column slot.
- `pulls/styles.ts` — small flex cell style for the badge group.
- `pulls/_components/PRRow/PRRow.tsx` — new cell renders `FindingsPopover`
  with `counts={pr.findings ?? zeroCounts}`, `scope="pr"`. `findings` comes
  from `usePrReviews(hovered ? pr.id : null)` (existing hook,
  `client/src/lib/hooks/reviews.ts`) flattened across all reviews — the
  `enabled: !!prId` guard already in that hook means passing `null` while not
  hovered skips the fetch entirely. `repoFullName` passed down from
  `page.tsx` (already reads `activeRepo.full_name`), `headSha = pr.head_sha`.
- `messages/en/prReview.json` — `list.columns.findings` label, new
  `findingsPopover.{titleAll,titleRun,empty}` keys.

## Agent runs tab wiring

- `[number]/_components/FindingsTab/FindingsTab.tsx` — already receives
  `runs: ReviewRecord[]` (full findings) and `prRuns: RunSummary[]` as props.
  Build `Map<run_id, ReviewRecord>` from `runs`; pass down to `RunHistory`
  along with `repoFullName`/`headSha` (already available in this component).
  No new fetch — this data is already loaded for `ReviewRunAccordion`.
- `[number]/_components/RunHistory/RunHistory.tsx` — replace the plain-text
  `t("runStatus.findings", {count})` line with `FindingsPopover`
  (`scope="run"`), counts computed from that run's joined review findings
  (open-filtered), `findings` passed directly (always loaded, no
  `loadingFindings`).

## Out of scope

- Click/pin popover, keyboard navigation — hover-only for now.
- Reviving the dead `INFO` severity.
- Portal-based positioning (see clipping note above).
