import type { FindingRecord } from "@devdigest/shared";

export type SeverityCounts = { CRITICAL: number; WARNING: number; SUGGESTION: number };

export function zeroCounts(): SeverityCounts {
  return { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
}

/** Findings not dismissed — the only ones that count toward a badge/total. */
export function openFindings(findings: FindingRecord[]): FindingRecord[] {
  return findings.filter((f) => !f.dismissed_at);
}

export function countBySeverity(findings: FindingRecord[]): SeverityCounts {
  const counts = zeroCounts();
  for (const f of findings) {
    if (f.severity === "CRITICAL" || f.severity === "WARNING" || f.severity === "SUGGESTION") {
      counts[f.severity] += 1;
    }
  }
  return counts;
}

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

/** Severity (critical→warning→suggestion) then confidence desc. */
export function sortFindings(findings: FindingRecord[]): FindingRecord[] {
  return findings.slice().sort((a, b) => {
    const rankDiff = (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99);
    if (rankDiff !== 0) return rankDiff;
    return b.confidence - a.confidence;
  });
}

/** "11" for a single-line finding, "11-15" for a range. */
export function lineLabel(f: Pick<FindingRecord, "start_line" | "end_line">): string {
  return f.start_line === f.end_line ? `${f.start_line}` : `${f.start_line}-${f.end_line}`;
}

/** First line (or first ~140 chars) of the rationale, for a compact preview row. */
export function rationalePreview(rationale: string, max = 140): string {
  const firstLine = rationale.split("\n")[0]!.trim();
  return firstLine.length > max ? `${firstLine.slice(0, max - 1)}…` : firstLine;
}

export const SEVERITY_ORDER = ["CRITICAL", "WARNING", "SUGGESTION"] as const;
