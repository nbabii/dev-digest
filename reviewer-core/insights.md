# Insights — reviewer-core

Non-obvious things learned while working in this module — discovered gotchas,
dead ends, decisions and the reasoning behind them, "why is it done this way"
answers. Captured by the `engineering-insights` skill. Append-only: never
rewrite or delete a past entry — a correction is a new dated entry that
references the old one. Check this file before deep-diving in this module.

## What Works

## What Doesn't Work

## Decisions

- **2026-09-28** — `PromptParts.intent`/`ReviewInput.intent` (Intent Layer plan) is a soft PROMPT INSTRUCTION only, not a mechanical drop-gate like `grounding.ts`'s citation check — `assemblePrompt` renders it as an untrusted block with "generally suppress out-of-scope findings UNLESS genuinely CRITICAL" wording, but never filters `Finding[]` itself. Deliberate: a hard gate keyed on the model's own scope judgment would reintroduce exactly the self-report-trust problem `grounding.ts` exists to avoid, and risks silently dropping a real defect the model correctly flagged. Rendered right after `task` and before `prDescription` in `userSections` (`src/prompt.ts`'s `assemblePrompt`) — the distilled/derived understanding comes first, then the raw description it was derived from.

- **2026-09-28** — `assemblePrompt`'s new `sections: PromptSectionMeta[]` return value (safe prompt-assembly logging) deliberately carries only `{ name, source, chars }` per rendered section, never the section text — computed here (not server-side) because this is the one place that already knows the exact render-order/omit-when-empty rules, but it stays a pure, synchronous, no-side-effect return value (no logger call, no I/O) so `reviewer-core`'s "only side effect is the injected LLMProvider" contract (`reviewer-core/CLAUDE.md`) holds. The actual `runLog.info(...)` call lives in `server/run-executor.ts`, which owns observability — see `server/insights.md`'s matching entry for the verbose/local-only gate built on top of this.

## Recurring Errors & Fixes

## Codebase Patterns & Tool Notes

## Open Questions

## Session Notes
