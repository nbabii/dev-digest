import type { BlastService } from '../services/blast.js';
import type { FindingsService } from '../services/findings.js';
import type { RunReviewService } from '../services/run-review.js';

/** What every tool registrar receives; built once in server.ts from the injected port. */
export interface ToolDeps {
  findings: FindingsService;
  blast: BlastService;
  runReview: RunReviewService;
  /** Shown in "API not reachable at <url>" errors. */
  baseUrl: string;
}
