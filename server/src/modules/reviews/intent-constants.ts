/**
 * Intent classifier limits — deliberately smaller than Skills' import limits
 * (`server/src/modules/skills/import-parser.ts`'s `IMPORT_LIMITS`): a linked
 * ticket/spec/doc URL found in a PR body is supplementary context for a
 * cheap, fast classification call, not a full skill import (see
 * docs/plans/intent-layer.md, Architecture decision 2).
 */
export const INTENT_FETCH_LIMITS = {
  /** Byte cap for one linked-doc fetch — enough for a ticket/spec page of
   *  prose, not a full document bundle. */
  MAX_DOC_BYTES: 200 * 1024, // 200 KB
  /** Abort a linked-doc fetch after this long. The classifier as a whole is
   *  meant to be cheap/fast ("before the main review call") — a slow doc
   *  fetch shouldn't dominate that budget. */
  FETCH_TIMEOUT_MS: 5_000,
} as const;

/**
 * At most this many `https://` URLs found in the PR body are fetched as
 * supplementary linked docs (excluding one already resolved as the linked
 * issue) — caps both latency and prompt size.
 */
export const MAX_LINKED_DOCS = 3;

/**
 * A PR description shorter than this many characters (after trim) is
 * "thin" for the deterministic `insufficient_context` backstop — never
 * trust the model's self-report alone for this, mirroring
 * `reviewer-core/grounding.ts`'s "never trust the model's self-reported
 * score" philosophy (docs/plans/intent-layer.md, `IntentService.classify`).
 */
export const THIN_DESCRIPTION_CHARS = 20;
