/**
 * BlastService — read-only "what else can this PR affect" report.
 *
 * Reads ONLY data repo-intel already indexed (Postgres). It never calls an
 * LLM, never clones/fetches, never parses, and never uses the facade's ripgrep
 * fallback: `getBlastRadius` is called only after `getIndexState` says the
 * persistent index is usable (decision 3), and a `degraded` answer is treated
 * as "not available". See docs/plans/blast-radius.md.
 */
import type { BlastIndex, BlastRadiusReport } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import type { IndexState } from '../repo-intel/types.js';
import { BlastRepository, type BlastStore, type ChangedFilePatch } from './repository.js';
import { MAX_CHANGED_FILES, MAX_UNCOVERED_LISTED } from './constants.js';
import {
  dedupeCandidates,
  deriveIndex,
  groupBlast,
  selectTouchedSymbols,
  splitRawDiff,
  touchedBaseLines,
  type TouchedLines,
} from './helpers.js';

type Source = BlastRadiusReport['changed_files']['source'];

interface ResolvedFiles {
  files: ChangedFilePatch[];
  source: Source;
  truncated: boolean;
}

export interface BlastLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
}

export class BlastService {
  private store: BlastStore;

  constructor(
    private container: Container,
    store?: BlastStore,
  ) {
    this.store = store ?? new BlastRepository(container.db);
  }

  async getBlastRadius(
    workspaceId: string,
    prId: string,
    log?: BlastLogger,
  ): Promise<BlastRadiusReport> {
    const pull = await this.store.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.store.getRepoBasics(pull.repoId);
    if (!repo) throw new NotFoundError('Repository not found');

    const resolved = await this.resolveChangedFiles(pull, repo);
    const paths = resolved.files.map((f) => f.path);
    const flagEnabled = this.container.config.repoIntelEnabled;

    const base = {
      repo: repo.fullName,
      pr_id: pull.id,
      pr_number: pull.number,
    };
    const emptyReport = (
      index: BlastIndex,
      extra: Partial<BlastRadiusReport['changed_files']> = {},
    ): BlastRadiusReport => ({
      ...base,
      index,
      changed_files: {
        total: paths.length,
        covered: 0,
        uncovered: [],
        no_symbol_touched: [],
        without_patch: 0,
        source: resolved.source,
        truncated: resolved.truncated,
        ...extra,
      },
      totals: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
      symbols: [],
      limits: { symbols_truncated: false, callers_truncated: false },
    });
    const finish = (r: BlastRadiusReport): BlastRadiusReport => {
      log?.info(
        {
          prId,
          indexStatus: r.index.status,
          indexing: r.index.indexing,
          changedFiles: r.changed_files.total,
          symbols: r.totals.symbols,
          callers: r.totals.callers,
          source: r.changed_files.source,
        },
        'blast radius served',
      );
      return r;
    };
    const readFailed = (index: BlastIndex): BlastRadiusReport =>
      finish(emptyReport({ ...index, status: 'degraded', available: false, reason: 'read_failed' }));

    // 1. Index state (flag off / no row / degraded => honest empty report).
    let state: IndexState | null = null;
    if (flagEnabled) {
      try {
        state = await this.container.repoIntel.getIndexState(pull.repoId);
      } catch {
        return readFailed(deriveIndex({ flagEnabled, state: null }));
      }
    }
    const index = deriveIndex({ flagEnabled, state });
    if (!index.available || paths.length === 0) return finish(emptyReport(index));

    // 2. Candidate symbols in the changed files, then the diff-touched subset.
    try {
      const rows = await this.container.repoIntel.getSymbolsInFiles(pull.repoId, paths);
      const coveredFiles = new Set(rows.map((r) => r.file));
      const uncovered = paths.filter((p) => !coveredFiles.has(p));

      const touchedByFile = new Map<string, TouchedLines | null>();
      for (const f of resolved.files) {
        touchedByFile.set(f.path, f.patch ? touchedBaseLines(f.patch) : null);
      }
      const selection = selectTouchedSymbols(dedupeCandidates(rows), touchedByFile);
      const changedFiles = {
        total: paths.length,
        covered: coveredFiles.size,
        uncovered: uncovered.slice(0, MAX_UNCOVERED_LISTED),
        no_symbol_touched: selection.noSymbolTouched.slice(0, MAX_UNCOVERED_LISTED),
        without_patch: selection.withoutPatch.length,
        source: resolved.source,
        truncated: resolved.truncated,
      };

      // 3. Callers only for files that have at least one touched symbol.
      const filesWithTouched = [...new Set(selection.touched.map((s) => s.symbol.file))];
      if (filesWithTouched.length === 0) {
        return finish({ ...emptyReport(index), changed_files: changedFiles });
      }
      const blast = await this.container.repoIntel.getBlastRadius(pull.repoId, filesWithTouched);
      if (blast.degraded) {
        // Index went away mid-flight; the facade fell back to ripgrep. Discard it.
        return finish(
          emptyReport(
            { ...index, status: 'degraded', available: false, reason: blast.reason ?? 'degraded' },
            changedFiles,
          ),
        );
      }

      const grouped = groupBlast({
        touched: selection.touched,
        callers: blast.callers,
        factsByFile: blast.factsByFile ?? {},
        fullName: repo.fullName,
        ref: index.last_indexed_sha ?? repo.defaultBranch,
        rowCapHit: blast.callersTruncated === true,
      });
      return finish({
        ...base,
        index,
        changed_files: changedFiles,
        totals: grouped.totals,
        symbols: grouped.symbols,
        limits: grouped.limits,
      });
    } catch {
      return readFailed(index);
    }
  }

  /**
   * Changed files WITH patches, from data we already have, in three tiers:
   * (a) persisted `pr_files`, (b) `git diff base...head` on the existing clone,
   * (c) GitHub's PR file list (read-only, not persisted; the normal case for a
   * PR first asked about through MCP, since only `GET /pulls/:id` writes
   * `pr_files`). The first non-empty tier wins.
   */
  private async resolveChangedFiles(
    pull: { id: string; number: number; base: string; headSha: string },
    repo: { owner: string; name: string },
  ): Promise<ResolvedFiles> {
    const ref = { owner: repo.owner, name: repo.name };
    const cap = (files: ChangedFilePatch[], source: Source): ResolvedFiles => ({
      files: files.slice(0, MAX_CHANGED_FILES),
      source,
      truncated: files.length > MAX_CHANGED_FILES,
    });

    try {
      const rows = await this.store.getChangedFiles(pull.id);
      if (rows.length > 0) return cap(rows, 'pr_files');
    } catch {
      /* next tier */
    }
    try {
      const diff = await this.container.git.diff(ref, pull.base, pull.headSha);
      const files = splitRawDiff(diff.raw);
      if (files.length > 0) return cap(files, 'git');
    } catch {
      /* next tier */
    }
    try {
      const gh = await this.container.github();
      const detail = await gh.getPullRequest(ref, pull.number);
      const files = detail.files.map((f) => ({ path: f.path, patch: f.patch ?? null }));
      if (files.length > 0) return cap(files, 'github');
    } catch {
      /* no token / network: report source "none" */
    }
    return { files: [], source: 'none', truncated: false };
  }
}
