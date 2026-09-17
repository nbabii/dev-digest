# Insights — client

Non-obvious things learned while working in this module — discovered gotchas,
dead ends, decisions and the reasoning behind them, "why is it done this way"
answers. Captured by the `engineering-insights` skill. Append-only: never
rewrite or delete a past entry — a correction is a new dated entry that
references the old one. Check this file before deep-diving in this module.

## What Works

## What Doesn't Work

- **2026-09-16** — An in-flow hover popover (`position: relative` wrapper + `position: absolute` panel, the pattern `@devdigest/ui`'s `Dropdown.tsx` uses) gets clipped by an `overflow: hidden` ancestor whose height auto-sizes to its content — e.g. the PR list's `tableCard`. This isn't just a "near the bottom of a long list" edge case: with a short list (even one row), the container's box ends right at the row, so the panel is clipped to a sliver almost immediately. Confirmed visually before switching to a portaled fix (see Decisions) (`client/src/components/findings-popover/FindingsPopover.tsx`).

## Decisions

- **2026-09-16** — `FindingsPopover`'s panel is rendered via `createPortal(..., document.body)` with `position: fixed`, positioned from the trigger's `getBoundingClientRect()`, instead of `Dropdown.tsx`'s in-flow absolute approach — required to escape `overflow: hidden` ancestors that auto-size to content (see What Doesn't Work). The same `onMouseEnter`/`onMouseLeave` handlers are attached to both the trigger and the portaled panel; this still works for the hover-intent gap between them because open/close is timer-based (`setTimeout` cleared on re-entry), not DOM-containment-based (`client/src/components/findings-popover/FindingsPopover.tsx`).

## Recurring Errors & Fixes

- **2026-09-16** — Setting only `overflowY: "auto"` (leaving `overflowX` unset) produced a stray horizontal scrollbar on a panel that never intentionally overflows sideways. Cause: per the CSS overflow spec, if one of `overflow-x`/`overflow-y` is set to a non-`visible` value and the other is left at its initial `visible`, the browser computes the `visible` one as `auto` too — so `overflowY: auto` silently implies `overflowX: auto`. Fix: always set `overflowX` explicitly (e.g. `"hidden"`) whenever `overflowY` is set on a container that shouldn't scroll horizontally (`client/src/components/findings-popover/FindingsPopover.tsx`).
- **2026-09-16** — Don't hardcode a popover/panel's `maxHeight` (e.g. a flat `360`) — short content will scroll unnecessarily even when it would easily fit. Compute it from actual remaining space instead: `Math.min(CAP, window.innerHeight - triggerRect.bottom - margin)` at open time (`client/src/components/findings-popover/FindingsPopover.tsx`).

## Codebase Patterns & Tool Notes

- **2026-09-16** — `client/src/lib/types.ts` can contain unused, pre-scaffolded types that hint at an intended-but-not-yet-built shape — e.g. `PrRowView.findings: {CRITICAL,WARNING,SUGGESTION}` already existed there, unused, before the findings-counter feature was implemented, and matched the shape the new `PrMeta.findings` field ended up needing. Worth grepping `lib/types.ts` for a matching unused type before designing a new contract shape from scratch.

## Open Questions

## Session Notes
