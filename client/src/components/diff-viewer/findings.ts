/** Pure helpers mapping review findings onto diff files/lines (RIGHT side only). */
import type { FindingRecord } from "@devdigest/shared";
import type { Line } from "./helpers";

/**
 * Open findings per file path. Dismissed findings are dropped; accepted ones are kept
 * (rendered muted by FindingCard). Insertion order is preserved.
 */
export function mapFindingsToFiles(findings: FindingRecord[]): Map<string, FindingRecord[]> {
  const out = new Map<string, FindingRecord[]>();
  for (const f of findings) {
    if (f.dismissed_at) continue;
    const list = out.get(f.file);
    if (list) list.push(f);
    else out.set(f.file, [f]);
  }
  return out;
}

/**
 * Split a file's findings into ones anchored to a rendered RIGHT-side line
 * (`add`/`ctx` with `newNo === start_line`, keyed by that line number) and
 * unanchored ones (line not in the patch, or no patch) which are never dropped.
 */
export function resolveAnchors(
  findings: FindingRecord[],
  lines: Line[],
): { anchored: Map<number, FindingRecord[]>; unanchored: FindingRecord[] } {
  const rendered = new Set<number>();
  for (const ln of lines) {
    if ((ln.kind === "add" || ln.kind === "ctx") && ln.newNo != null) rendered.add(ln.newNo);
  }
  const anchored = new Map<number, FindingRecord[]>();
  const unanchored: FindingRecord[] = [];
  for (const f of findings) {
    if (rendered.has(f.start_line)) {
      const list = anchored.get(f.start_line);
      if (list) list.push(f);
      else anchored.set(f.start_line, [f]);
    } else {
      unanchored.push(f);
    }
  }
  return { anchored, unanchored };
}
