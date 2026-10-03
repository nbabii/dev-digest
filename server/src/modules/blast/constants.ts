/**
 * blast constants — read-side caps. Every number the report can show is either
 * a pre-cap total (`totals`, `*_total`) or one of these capped list sizes.
 */

/** Max changed symbols listed in the report (totals stay pre-cap). */
export const MAX_SYMBOLS = 30;
/**
 * Max callers listed per symbol. Same value as repo-intel's own
 * `MAX_CALLERS_PER_SYMBOL`; the facade no longer applies it globally.
 */
export const MAX_CALLERS_PER_SYMBOL = 20;
export const MAX_ENDPOINTS_PER_SYMBOL = 25;
export const MAX_CRONS_PER_SYMBOL = 10;
/** Max uncovered / no-symbol-touched file paths listed. */
export const MAX_UNCOVERED_LISTED = 20;
/** `inArray` bound for changed files; beyond it `changed_files.truncated`. */
export const MAX_CHANGED_FILES = 1000;
