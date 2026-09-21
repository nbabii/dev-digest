import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { wrapUntrusted } from '@devdigest/reviewer-core';
import {
  ConventionCandidateProposals,
  type ConventionCandidate,
  type ConventionScan,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { loadPromptTemplate } from '../../platform/prompts.js';
import { getFeatureModelOverride } from '../settings/feature-models.js';
import {
  ConventionsRepository,
  type InsertCandidate,
  type ConventionRow,
  type ConventionScanRow,
} from './repository.js';
import {
  CONFIG_FILE_CANDIDATES,
  CONVENTIONS_DEFAULT_MODEL,
  CONVENTIONS_EXTRACT_JOB_KIND,
  MAX_EVIDENCE_LINE_SPAN,
  MAX_SAMPLE_CHARS_PER_FILE,
  MAX_SAMPLE_LINES_PER_FILE,
  SCAN_STALE_MS,
  TOP_RANKED_SAMPLE_COUNT,
} from './constants.js';

export interface ConventionsListResult {
  scan: ConventionScan | null;
  candidates: ConventionCandidate[];
}

/**
 * Conventions Extractor service — see server/specs/conventions-extractor.md.
 * Mirrors `repo-intel`'s layering: one job kind, registered once at route
 * plugin load, driving a scan-shaped (not CRUD-shaped) read model.
 */
export class ConventionsService {
  private readonly repo: ConventionsRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
  }

  registerJobHandler(): void {
    this.container.jobs.register(CONVENTIONS_EXTRACT_JOB_KIND, async (payload) => {
      const { repoId } = payload as { repoId: string };
      await this.runExtraction(repoId);
    });
  }

  async listForRepo(repoId: string): Promise<ConventionsListResult> {
    let scan = await this.repo.getLatestScan(repoId);
    if (!scan) return { scan: null, candidates: [] };
    scan = await this.reconcileIfStale(scan);
    const candidates = await this.repo.listByScan(scan.id);
    return { scan: toApiScan(scan), candidates: candidates.map(toApiCandidate) };
  }

  /**
   * True iff the repo's latest scan is genuinely still in flight (not stale)
   * — used by `POST /repos/:id/conventions/extract` to refuse starting a
   * second concurrent scan for the same repo. Without this, two
   * near-simultaneous clicks on "Re-scan" enqueue two jobs against the same
   * repo; if the process crashes/restarts while either is mid-run, its scan
   * row is orphaned at `status: 'running'` forever (see `SCAN_STALE_MS`'s
   * doc comment) and the newer of the two rows — win-or-lose — is what
   * `GET /repos/:id/conventions` shows, silently burying the other's result.
   * This narrows the race window; it is NOT a DB-level lock (no unique
   * constraint/advisory lock added) — acceptable for a human-clicks-a-button
   * frequency, not a high-throughput path.
   */
  async hasActiveScan(repoId: string): Promise<boolean> {
    const scan = await this.repo.getLatestScan(repoId);
    if (!scan) return false;
    const reconciled = await this.reconcileIfStale(scan);
    return reconciled.status === 'running';
  }

  /**
   * A `running` scan older than `SCAN_STALE_MS` is orphaned (its process
   * crashed/restarted mid-run — `JobRunner` has no persistence to resume
   * it), not genuinely in-flight. Reconciling it here — on read, not just at
   * boot — also catches a same-process hang, not only a crash/restart.
   */
  private async reconcileIfStale(scan: ConventionScanRow): Promise<ConventionScanRow> {
    const isStale = scan.status === 'running' && Date.now() - scan.startedAt.getTime() > SCAN_STALE_MS;
    if (!isStale) return scan;
    await this.repo.failScan(scan.id, 'stale_timeout');
    return { ...scan, status: 'failed', error: 'stale_timeout', finishedAt: new Date() };
  }

  async updateCandidate(
    workspaceId: string,
    id: string,
    patch: { status?: 'pending' | 'accepted' | 'rejected'; rule?: string; category?: ConventionCandidate['category'] },
  ): Promise<ConventionCandidate | undefined> {
    const row = await this.repo.update(workspaceId, id, patch);
    return row ? toApiCandidate(row) : undefined;
  }

  // -------------------------------------------------------------------------
  // Extraction pipeline (the job handler body).
  // -------------------------------------------------------------------------

  /**
   * Code-only sample selection — no model call. Config files (existence
   * only) + top-ranked source files (`repoIntel.getConventionSamples`), read
   * from the clone and soft-truncated. Root-level configs only in v1 (see
   * spec's documented monorepo limitation).
   */
  private async collectSamples(
    clonePath: string,
    repoId: string,
  ): Promise<{ path: string; content: string }[]> {
    const samples: { path: string; content: string }[] = [];

    for (const candidate of CONFIG_FILE_CANDIDATES) {
      const content = await readClone(clonePath, candidate);
      if (content !== null) samples.push({ path: candidate, content: truncate(content) });
    }

    const ranked = await this.container.repoIntel.getConventionSamples(
      repoId,
      TOP_RANKED_SAMPLE_COUNT,
    );
    for (const path of ranked) {
      const content = await readClone(clonePath, path);
      if (content !== null) samples.push({ path, content: truncate(content) });
    }

    return samples;
  }

  async runExtraction(repoId: string): Promise<void> {
    const repo = await this.repo.getRepoBasics(repoId);
    if (!repo || !repo.clonePath) {
      // No scan row exists yet in this case (extraction never started) —
      // nothing to mark failed. The route already returned a degraded 202.
      return;
    }
    const clonePath = repo.clonePath;

    const samples = await this.collectSamples(clonePath, repoId);
    if (samples.length === 0) {
      const scan = await this.repo.createScan({
        workspaceId: repo.workspaceId,
        repoId,
        sampleFileCount: 0,
      });
      await this.repo.failScan(scan.id, 'no_samples');
      return;
    }

    const scan = await this.repo.createScan({
      workspaceId: repo.workspaceId,
      repoId,
      sampleFileCount: samples.length,
    });

    try {
      const override = await getFeatureModelOverride(this.container, repo.workspaceId, 'conventions');
      const choice = override ?? CONVENTIONS_DEFAULT_MODEL;
      const llm = await this.container.llm(choice.provider);

      const systemPrompt = await loadPromptTemplate('conventions.system.md');
      const sampleBlocks = samples.map((s) => wrapUntrusted(s.path, s.content)).join('\n\n');

      const result = await llm.completeStructured({
        model: choice.model,
        schema: ConventionCandidateProposals,
        schemaName: 'convention_candidate_proposals',
        temperature: 0.2,
        maxRetries: 2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: sampleBlocks },
        ],
      });

      const verified: InsertCandidate[] = [];
      let discarded = 0;
      for (const proposal of result.data.candidates) {
        const grounded = await this.verifyEvidence(clonePath, proposal);
        if (!grounded) {
          discarded += 1;
          continue;
        }
        verified.push({
          workspaceId: repo.workspaceId,
          repoId,
          scanId: scan.id,
          category: proposal.category,
          rule: proposal.rule,
          evidencePath: proposal.evidence_path,
          evidenceLineStart: proposal.evidence_line_start,
          evidenceLineEnd: proposal.evidence_line_end,
          evidenceSnippet: grounded.snippet,
          confidence: proposal.confidence,
        });
      }

      await this.repo.insertCandidates(verified);
      await this.repo.completeScan(scan.id, {
        provider: choice.provider,
        model: result.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: result.costUsd,
        candidatesFound: verified.length,
        candidatesDiscarded: discarded,
      });
    } catch (err) {
      await this.repo.failScan(scan.id, err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Code-only, no model trust: file exists, line range exists and is capped,
   * then the REAL lines are re-read from the clone — never the model's own
   * copy. See spec's Evidence verification / Grounding section.
   */
  private async verifyEvidence(
    clonePath: string,
    proposal: { evidence_path: string; evidence_line_start: number; evidence_line_end: number },
  ): Promise<{ snippet: string } | null> {
    if (proposal.evidence_path.includes('..')) return null; // defense-in-depth, not attacker input in practice

    const content = await readClone(clonePath, proposal.evidence_path);
    if (content === null) return null;

    const lines = content.split('\n');
    const { evidence_line_start: start, evidence_line_end: end } = proposal;
    if (start < 1 || end < start || end > lines.length) return null;
    if (end - start > MAX_EVIDENCE_LINE_SPAN) return null;

    return { snippet: lines.slice(start - 1, end).join('\n') };
  }
}

async function readClone(clonePath: string, file: string): Promise<string | null> {
  return readFile(join(clonePath, file), 'utf8').catch(() => null);
}

function truncate(content: string): string {
  const lines = content.split('\n').slice(0, MAX_SAMPLE_LINES_PER_FILE).join('\n');
  return lines.length > MAX_SAMPLE_CHARS_PER_FILE ? lines.slice(0, MAX_SAMPLE_CHARS_PER_FILE) : lines;
}

function toApiCandidate(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    scan_id: row.scanId,
    repo_id: row.repoId,
    category: row.category as ConventionCandidate['category'],
    rule: row.rule,
    evidence_path: row.evidencePath,
    evidence_line_start: row.evidenceLineStart,
    evidence_line_end: row.evidenceLineEnd,
    evidence_snippet: row.evidenceSnippet,
    confidence: row.confidence,
    status: row.status as ConventionCandidate['status'],
    created_at: row.createdAt.toISOString(),
  };
}

function toApiScan(row: ConventionScanRow): ConventionScan {
  return {
    id: row.id,
    repo_id: row.repoId,
    status: row.status as ConventionScan['status'],
    sample_file_count: row.sampleFileCount,
    candidates_found: row.candidatesFound,
    candidates_discarded: row.candidatesDiscarded,
    error: row.error,
    started_at: row.startedAt.toISOString(),
    finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
  };
}
