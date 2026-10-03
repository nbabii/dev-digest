/* Pure helpers for BlastRadiusCard. Counts are never derived from the
   (capped) arrays — consumers read `totals` / `*_total` from the response
   (docs/plans/blast-radius.md, decision 11). */
import type { BlastRadiusReport, BlastSymbolImpact } from "@devdigest/shared";
import { DEFAULT_OPEN_SYMBOLS, SHORT_SHA_LENGTH } from "./constants";

export type NoticeKey =
  | "disabled"
  | "notIndexed"
  | "indexing"
  | "degraded"
  | "noChangedFiles"
  | "noSymbols"
  | "noSymbolTouched"
  | "reindexing"
  | "partial"
  | "factsIncomplete"
  | "zeroCallers"
  | "zeroCallersIncomplete"
  | "uncovered";

export function symbolKey(sym: Pick<BlastSymbolImpact, "file" | "symbol">): string {
  return `${sym.file}::${sym.symbol}`;
}

/** First N symbols that have callers start expanded. */
export function defaultOpenKeys(symbols: BlastSymbolImpact[]): Set<string> {
  return new Set(
    symbols
      .filter((sym) => sym.callers_total > 0)
      .slice(0, DEFAULT_OPEN_SYMBOLS)
      .map(symbolKey),
  );
}

/** A notice that replaces the data entirely (nothing meaningful to list). */
export function blockingNotice(report: BlastRadiusReport): NoticeKey | null {
  const { index, changed_files: files } = report;
  if (index.status === "disabled") return "disabled";
  if (!index.available) {
    if (index.indexing) return "indexing";
    return index.status === "not_indexed" ? "notIndexed" : "degraded";
  }
  if (files.total === 0) return "noChangedFiles";
  if (report.symbols.length === 0) return files.no_symbol_touched.length > 0 ? "noSymbolTouched" : "noSymbols";
  return null;
}

/** Notices shown above the data when the data itself is still worth showing. */
export function bannerNotices(report: BlastRadiusReport): NoticeKey[] {
  const { index, changed_files: files, totals } = report;
  const incomplete = index.status === "partial" || !index.facts_complete;
  const banners: NoticeKey[] = [];
  if (index.indexing) banners.push("reindexing");
  if (totals.callers === 0 && incomplete) banners.push("zeroCallersIncomplete");
  else {
    if (index.status === "partial") banners.push(index.facts_complete ? "partial" : "factsIncomplete");
    if (totals.callers === 0) banners.push("zeroCallers");
  }
  if (files.no_symbol_touched.length > 0) banners.push("noSymbolTouched");
  if (files.uncovered.length > 0) banners.push("uncovered");
  return banners;
}

export function noticeCount(key: NoticeKey, report: BlastRadiusReport): number {
  const files = report.changed_files;
  if (key === "noSymbolTouched") return files.no_symbol_touched.length;
  if (key === "uncovered") return Math.max(files.total - files.covered, files.uncovered.length);
  return 0;
}

export function noticeFiles(key: NoticeKey, report: BlastRadiusReport): string[] {
  if (key === "noSymbolTouched") return report.changed_files.no_symbol_touched;
  if (key === "uncovered") return report.changed_files.uncovered;
  return [];
}

export function shortSha(sha: string | null): string | null {
  return sha ? sha.slice(0, SHORT_SHA_LENGTH) : null;
}
