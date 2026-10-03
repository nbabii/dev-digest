// Blast-radius use case: repo + PR resolution, one port call, state -> status/hint. No I/O beyond the port.
import { shapeBlast, type ResponseFormat, type ShapedBlast } from '../format.js';
import type { BlastRadiusReport, DevDigestApi } from '../ports.js';
import type { Resolver } from './resolve.js';

export type BlastStatus = 'ok' | 'index_unavailable' | 'no_changed_files';

export interface BlastInput {
  repo: string;
  pr: number;
  symbol?: string;
  response_format?: ResponseFormat;
}

export type BlastResult = ShapedBlast & { status: BlastStatus; hint: string };

export function blastStatus(r: BlastRadiusReport): BlastStatus {
  if (!r.index.available) return 'index_unavailable';
  if (r.changed_files.total === 0) return 'no_changed_files';
  return 'ok';
}

/** Forward-leading, pure function of `index` and `changed_files`. Degraded states are data, not errors. */
export function blastHint(r: BlastRadiusReport): string {
  const { index, changed_files: cf } = r;
  if (!index.available) {
    if (index.indexing) return 'indexing in progress; retry in ~30 s';
    const why = index.reason ? ` (${index.reason})` : '';
    switch (index.status) {
      case 'not_indexed':
        return 'repo is not indexed; open it in DevDigest (Project Context, Re-analyze), then call again';
      case 'disabled':
        return `repo intelligence is disabled${why}; enable it in the DevDigest server config, then call again`;
      default:
        return `index is ${index.status}${why}; re-analyze the repo in DevDigest (Project Context), then call again`;
    }
  }
  if (cf.total === 0) {
    return 'no changed files known for this PR; open the PR once in DevDigest, then call again';
  }
  const parts: string[] = [];
  if (index.indexing) parts.push('re-indexing in progress; results may change, retry in ~30 s');
  if (index.status === 'partial' || !index.facts_complete) {
    parts.push('index partial; endpoints/crons may be incomplete');
  }
  if (r.symbols.length === 0) {
    parts.push(
      cf.no_symbol_touched.length > 0
        ? 'the diff touches no indexed symbol (only imports or top-level code)'
        : 'no indexed symbols in the changed files; code added by this PR is not in the index',
    );
  }
  if (r.limits.symbols_truncated || r.limits.callers_truncated) {
    parts.push('API lists are capped; totals are exact unless callers_truncated');
  }
  if (parts.length === 0) parts.push(`showing ${r.symbols.length} of ${r.totals.symbols} symbols`);
  return parts.join('; ');
}

export function createBlastService(api: DevDigestApi, resolver: Resolver) {
  return {
    async getBlastRadius(input: BlastInput): Promise<BlastResult> {
      const repo = await resolver.repo(input.repo);
      const prId = await resolver.pull(repo.id, input.pr);
      const report = await api.blastRadius(prId);
      const shaped = shapeBlast(report, {
        ...(input.response_format !== undefined && { format: input.response_format }),
        ...(input.symbol !== undefined && { symbol: input.symbol }),
      });
      let hint = blastHint(report);
      if (input.symbol && shaped.symbols.length === 0 && report.symbols.length > 0) {
        hint = `no changed symbol named "${input.symbol}"; omit symbol to list all`;
      }
      return { ...shaped, status: blastStatus(report), hint };
    },
  };
}

export type BlastService = ReturnType<typeof createBlastService>;
