import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionCategory, ConventionStatus } from '@devdigest/shared';

import type { ConventionRow, ConventionScanRow } from '../../db/rows.js';
export type { ConventionRow, ConventionScanRow };

export interface RepoBasics {
  id: string;
  workspaceId: string;
  owner: string;
  name: string;
  fullName: string;
  clonePath: string | null;
}

export interface InsertScan {
  workspaceId: string;
  repoId: string;
  sampleFileCount: number;
}

export interface CompleteScan {
  provider?: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number | null;
  candidatesFound: number;
  candidatesDiscarded: number;
}

export interface InsertCandidate {
  workspaceId: string;
  repoId: string;
  scanId: string;
  category: ConventionCategory;
  rule: string;
  evidencePath: string;
  evidenceLineStart: number;
  evidenceLineEnd: number;
  evidenceSnippet: string;
  confidence: number;
}

export interface UpdateCandidate {
  status?: ConventionStatus;
  rule?: string;
  category?: ConventionCategory;
}

/**
 * Conventions data-access. Owns `convention_scans` (net-new) and the
 * extended `conventions` table (pre-existing, see
 * server/specs/conventions-extractor.md). Small, un-shared "repo basics"
 * read duplicated here rather than reused from another module's repository —
 * matches existing precedent (`repo-intel/repository.ts`'s own
 * `getRepoBasics`, not `ReposRepository.getById`).
 */
export class ConventionsRepository {
  constructor(private db: Db) {}

  async getRepoBasics(repoId: string): Promise<RepoBasics | null> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        workspaceId: t.repos.workspaceId,
        owner: t.repos.owner,
        name: t.repos.name,
        fullName: t.repos.fullName,
        clonePath: t.repos.clonePath,
      })
      .from(t.repos)
      .where(eq(t.repos.id, repoId));
    return row ?? null;
  }

  // ---- convention_scans -----------------------------------------------

  async createScan(values: InsertScan): Promise<ConventionScanRow> {
    const [row] = await this.db
      .insert(t.conventionScans)
      .values({
        workspaceId: values.workspaceId,
        repoId: values.repoId,
        sampleFileCount: values.sampleFileCount,
        status: 'running',
      })
      .returning();
    return row!;
  }

  /**
   * Guarded by `status = 'running'`: if the read-path's stale-scan
   * reconciliation (`ConventionsService.reconcileIfStale`) already flipped
   * this row to `failed` while this job kept running in the background
   * (`JobRunner` doesn't actually cancel the underlying call just because
   * its own 120s timeout gave up waiting on it), a late success must NOT
   * silently overwrite the `failed` status the user already saw. A no-op
   * `UPDATE` here (0 rows affected) is the correct outcome in that case —
   * the candidates were still inserted by the caller just before this call,
   * they simply stay attached to an already-superseded scan row.
   */
  async completeScan(scanId: string, patch: CompleteScan): Promise<void> {
    await this.db
      .update(t.conventionScans)
      .set({
        status: 'completed',
        provider: patch.provider,
        model: patch.model,
        tokensIn: patch.tokensIn,
        tokensOut: patch.tokensOut,
        costUsd: patch.costUsd ?? null,
        candidatesFound: patch.candidatesFound,
        candidatesDiscarded: patch.candidatesDiscarded,
        finishedAt: new Date(),
      })
      .where(and(eq(t.conventionScans.id, scanId), eq(t.conventionScans.status, 'running')));
  }

  /** Same `status = 'running'` guard as `completeScan` — see its doc comment. */
  async failScan(scanId: string, error: string): Promise<void> {
    await this.db
      .update(t.conventionScans)
      .set({ status: 'failed', error, finishedAt: new Date() })
      .where(and(eq(t.conventionScans.id, scanId), eq(t.conventionScans.status, 'running')));
  }

  /** Most recent scan for a repo — `GET /repos/:id/conventions` shows only this one. */
  async getLatestScan(repoId: string): Promise<ConventionScanRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventionScans)
      .where(eq(t.conventionScans.repoId, repoId))
      .orderBy(desc(t.conventionScans.startedAt))
      .limit(1);
    return row;
  }

  // ---- conventions (candidates) ----------------------------------------

  async insertCandidates(rows: InsertCandidate[]): Promise<ConventionRow[]> {
    if (rows.length === 0) return [];
    return this.db
      .insert(t.conventions)
      .values(
        rows.map((r) => ({
          workspaceId: r.workspaceId,
          repoId: r.repoId,
          scanId: r.scanId,
          category: r.category,
          rule: r.rule,
          evidencePath: r.evidencePath,
          evidenceLineStart: r.evidenceLineStart,
          evidenceLineEnd: r.evidenceLineEnd,
          evidenceSnippet: r.evidenceSnippet,
          confidence: r.confidence,
        })),
      )
      .returning();
  }

  async listByScan(scanId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(eq(t.conventions.scanId, scanId))
      .orderBy(desc(t.conventions.confidence));
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateCandidate,
  ): Promise<ConventionRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    // Same guard as SkillsRepository.update: an empty patch would issue
    // `UPDATE ... SET` with zero columns, which postgres-js/Drizzle rejects.
    if (patch.status === undefined && patch.rule === undefined && patch.category === undefined) {
      return existing;
    }

    const [row] = await this.db
      .update(t.conventions)
      .set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
      })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }
}
