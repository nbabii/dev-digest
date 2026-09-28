import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { Intent, IntentSource } from '@devdigest/shared';
import type { PullRow } from '../../../db/rows.js';

// ---- PR lookup (workspace-scoped) -----------------------------------------

export async function getPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<PullRow | undefined> {
  const [row] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  return row;
}

export async function getRepo(
  db: Db,
  repoId: string,
): Promise<typeof t.repos.$inferSelect | undefined> {
  const [row] = await db.select().from(t.repos).where(eq(t.repos.id, repoId));
  return row;
}

export async function getPrFiles(
  db: Db,
  prId: string,
): Promise<(typeof t.prFiles.$inferSelect)[]> {
  return db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
}

/**
 * Record the commit a review just ran against, so the PR list can derive
 * `reviewed` vs `needs_review` (head moved since the last review) vs `stale`.
 */
export async function markReviewed(db: Db, prId: string, sha: string): Promise<void> {
  await db
    .update(t.pullRequests)
    .set({ lastReviewedSha: sha })
    .where(eq(t.pullRequests.id, prId));
}

// ---- intent -----------------------------------------------------------------

/**
 * Model/cost attribution + staleness signals attached to a persisted `Intent`
 * — not part of the `Intent` contract itself (that's the classifier's OUTPUT
 * shape; these are bookkeeping the repository owns). Returned in full by
 * `getIntent` so `IntentService.getOrClassify` can do its staleness check
 * (`classifiedHeadSha`/`classifiedBodyHash` vs. current values) without a
 * second query.
 */
export interface IntentRecord extends Intent {
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  classifiedHeadSha: string;
  classifiedBodyHash: string;
  classifiedAt: Date;
}

export interface UpsertIntentValues extends Intent {
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  classifiedHeadSha: string;
  classifiedBodyHash: string;
}

export async function upsertIntent(db: Db, prId: string, values: UpsertIntentValues): Promise<void> {
  const row = {
    prId,
    summary: values.summary,
    inScope: values.in_scope,
    outOfScope: values.out_of_scope,
    confidence: values.confidence,
    insufficientContext: values.insufficient_context,
    sources: values.sources,
    provider: values.provider,
    model: values.model,
    tokensIn: values.tokensIn,
    tokensOut: values.tokensOut,
    costUsd: values.costUsd,
    classifiedHeadSha: values.classifiedHeadSha,
    classifiedBodyHash: values.classifiedBodyHash,
  };
  await db
    .insert(t.prIntent)
    .values(row)
    .onConflictDoUpdate({
      target: t.prIntent.prId,
      // classifiedAt defaults to now() on INSERT only — an update (reclassify,
      // or a fresh classify after staleness) must bump it explicitly.
      set: { ...row, classifiedAt: new Date() },
    });
}

export async function getIntent(db: Db, prId: string): Promise<IntentRecord | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  if (!row) return undefined;
  return {
    summary: row.summary,
    in_scope: row.inScope,
    out_of_scope: row.outOfScope,
    confidence: row.confidence,
    insufficient_context: row.insufficientContext,
    sources: row.sources as IntentSource[],
    provider: row.provider,
    model: row.model,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    costUsd: row.costUsd,
    classifiedHeadSha: row.classifiedHeadSha,
    classifiedBodyHash: row.classifiedBodyHash,
    classifiedAt: row.classifiedAt,
  };
}
