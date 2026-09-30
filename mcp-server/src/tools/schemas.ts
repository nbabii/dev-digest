// Shared input/annotation pieces for the tool registrars. No parameter .describe() (token budget).
import { z } from 'zod';
import { DEFAULT_LIMIT, MAX_LIMIT } from '../constants.js';
import { SEVERITY_LEVELS } from '../format.js';

export const responseFormat = z.enum(['concise', 'detailed']).default('concise');
export const severity = z.enum(SEVERITY_LEVELS);
export const limit = z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT);

/** Permissive object for nested items: keeps outputSchema tiny, still an object. */
export const item = z.object({}).passthrough();

export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const RUNS_REVIEW = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

/** Shared output fields of a shaped review (done / get_findings). */
export const reviewOutput = {
  run_id: z.string().optional(),
  verdict: z.string().nullable().optional(),
  score: z.number().nullable().optional(),
  summary: z.string().optional(),
  findings: z.array(item).optional(),
  total: z.number().optional(),
  next_cursor: z.string().optional(),
  truncated: z.boolean().optional(),
  hint: z.string().optional(),
};
