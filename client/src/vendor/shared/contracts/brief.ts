import { z } from 'zod';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief.
 */

// ---- Intent ----
export const IntentSource = z.object({
  kind: z.enum(['pr_description', 'linked_issue', 'linked_doc', 'changed_files']),
  ref: z.string(),
  status: z.enum(['used', 'unreachable', 'skipped']),
  error: z.string().nullish(),
});
export type IntentSource = z.infer<typeof IntentSource>;

export const Intent = z.object({
  summary: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  insufficient_context: z.boolean(),
  sources: z.array(IntentSource),
});
export type Intent = z.infer<typeof Intent>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Blast radius report (GET /pulls/:id/blast-radius) ----
export const BlastIndexStatus = z.enum(['ready', 'partial', 'degraded', 'not_indexed', 'disabled']);
export type BlastIndexStatus = z.infer<typeof BlastIndexStatus>;

export const BlastIndex = z.object({
  status: BlastIndexStatus,
  indexing: z.boolean(),
  available: z.boolean(),
  reason: z.string().nullable(),
  facts_complete: z.boolean(),
  last_indexed_sha: z.string().nullable(),
  indexed_at: z.string().nullable(),
});
export type BlastIndex = z.infer<typeof BlastIndex>;

export const BlastCallerLink = BlastCaller.extend({ url: z.string() });
export type BlastCallerLink = z.infer<typeof BlastCallerLink>;

export const BlastSymbolImpact = DownstreamImpact.extend({
  file: z.string(),
  kind: z.string(),
  line: z.number().int().nullable(),
  exported: z.boolean(),
  match: z.enum(['hunk', 'file']), // 'file' = per-file fallback (no usable patch/range)
  callers: z.array(BlastCallerLink),
  callers_total: z.number().int(),
  endpoints_total: z.number().int(),
  crons_total: z.number().int(),
});
export type BlastSymbolImpact = z.infer<typeof BlastSymbolImpact>;

export const BlastChangedFiles = z.object({
  total: z.number().int(),
  covered: z.number().int(),
  uncovered: z.array(z.string()),
  no_symbol_touched: z.array(z.string()),
  without_patch: z.number().int(),
  source: z.enum(['pr_files', 'git', 'github', 'none']),
  truncated: z.boolean(),
});
export type BlastChangedFiles = z.infer<typeof BlastChangedFiles>;

export const BlastRadiusReport = z.object({
  repo: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int(),
  index: BlastIndex,
  changed_files: BlastChangedFiles,
  totals: z.object({
    symbols: z.number().int(),
    callers: z.number().int(),
    endpoints: z.number().int(),
    crons: z.number().int(),
  }),
  symbols: z.array(BlastSymbolImpact),
  limits: z.object({ symbols_truncated: z.boolean(), callers_truncated: z.boolean() }),
});
export type BlastRadiusReport = z.infer<typeof BlastRadiusReport>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const Risk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

// ---- PR History ----
export const PrHistoryItem = z.object({
  pr_number: z.number().int(),
  title: z.string(),
  merged_at: z.string(),
  author: z.string(),
  files_overlap: z.array(z.string()),
  notes: z.string(),
});
export type PrHistoryItem = z.infer<typeof PrHistoryItem>;

export const PrHistory = z.object({
  history: z.array(PrHistoryItem),
});
export type PrHistory = z.infer<typeof PrHistory>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'wiring', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  finding_lines: z.array(z.number().int()),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- Composed PR Brief (pr_brief.json) ----
export const PrBrief = z.object({
  intent: Intent,
  blast: BlastRadius,
  risks: Risks,
  history: PrHistory,
});
export type PrBrief = z.infer<typeof PrBrief>;
