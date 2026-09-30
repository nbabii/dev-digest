/** Constants for the DiffViewer. */

import type { FileRole } from "./classify";

/** Files with this many or fewer changed lines start expanded. */
export const AUTO_EXPAND_MAX_LINES = 200;

/** Matches a unified-diff hunk header, e.g. `@@ -1,2 +1,3 @@`. */
export const HUNK_HEADER_RE = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Severity → CSS colour token. Deliberately duplicates the page-side FindingCard
    `SEV_COLOR` (shared components must not import from `app/`); keep in sync. */
export const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: "var(--crit)",
  WARNING: "var(--warn)",
  SUGGESTION: "var(--sugg)",
  INFO: "var(--info)",
};

export const SEVERITY_COLOR_FALLBACK = "var(--text-muted)";

/** Smart Diff group accent colours. */
export const ROLE_COLOR = {
  core: "var(--accent-text)",
  tests: "var(--sugg)",
  wiring: "var(--info)",
  docs: "var(--warn)",
  boilerplate: "var(--text-muted)",
} as const satisfies Record<FileRole, string>;

/** Groups that start collapsed. */
export const COLLAPSED_ROLES: ReadonlySet<FileRole> = new Set<FileRole>(["docs", "boilerplate"]);
