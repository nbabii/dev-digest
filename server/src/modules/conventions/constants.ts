import type { FeatureModelChoice } from '@devdigest/shared';

/** Enqueued from `routes.ts`, handled by `ConventionsService.runExtraction`. */
export const CONVENTIONS_EXTRACT_JOB_KIND = 'conventions-extract';

/**
 * This feature's OWN dynamic default — deliberately NOT `resolveFeatureModel`'s
 * static `FEATURE_MODELS` registry default (`openai`/`gpt-5.4`). See
 * `getFeatureModelOverride`'s doc comment (`settings/feature-models.ts`),
 * which names `conventions` by name as a caller that keeps its own default.
 * Same cheap provider+model onboarding already uses for a repo-analysis task
 * in the same cost class (`platform.ts` FEATURE_MODELS `onboarding` entry).
 */
export const CONVENTIONS_DEFAULT_MODEL: FeatureModelChoice = {
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4-flash',
};

/** Root-level config file globs checked for existence (content not read). */
export const CONFIG_FILE_CANDIDATES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.eslintrc.yaml',
  'tsconfig.json',
  'tsconfig.base.json',
  '.prettierrc',
  '.prettierrc.js',
  '.prettierrc.cjs',
  '.prettierrc.json',
  '.prettierrc.yml',
  '.prettierrc.yaml',
  'prettier.config.js',
  'prettier.config.cjs',
] as const;

/** Top-N ranked source files sampled via `repoIntel.getConventionSamples`. */
export const TOP_RANKED_SAMPLE_COUNT = 12;

/** Soft per-file truncation so one huge file can't blow the prompt budget. */
export const MAX_SAMPLE_LINES_PER_FILE = 200;
export const MAX_SAMPLE_CHARS_PER_FILE = 4000;

/** Evidence-verification caps — see server/specs/conventions-extractor.md. */
export const MAX_EVIDENCE_LINE_SPAN = 20;

/**
 * A `convention_scans` row stuck at `status: 'running'` longer than this is
 * treated as orphaned (dead) rather than genuinely in-flight — see
 * `ConventionsService.reconcileIfStale`. `JobRunner` is in-memory only (no
 * resume across process restarts, `server/src/platform/jobs.ts`), so a scan
 * whose API process crashed or restarted mid-run leaves its row `running`
 * forever with nothing left to ever finish it. Set comfortably above
 * `JobRunner`'s own hard per-job timeout (120s default) so a slow-but-alive
 * job is never misclassified as dead.
 */
export const SCAN_STALE_MS = 150_000;
