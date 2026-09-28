import { describe, it, expect } from "vitest";
import type { FindingRecord } from "@devdigest/shared";
import { mapFindingsToFiles, resolveAnchors } from "./findings";
import { parsePatch } from "./helpers";

const mk = (id: string, file: string, start_line: number, extra: Partial<FindingRecord> = {}): FindingRecord =>
  ({
    id,
    severity: "WARNING",
    category: "bug",
    title: id,
    file,
    start_line,
    end_line: start_line,
    rationale: "r",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...extra,
  }) as FindingRecord;

describe("mapFindingsToFiles", () => {
  it("drops dismissed, keeps accepted, groups by file", () => {
    const m = mapFindingsToFiles([
      mk("a", "x.ts", 1),
      mk("b", "x.ts", 2, { dismissed_at: "t" }),
      mk("c", "x.ts", 3, { accepted_at: "t" }),
      mk("d", "y.ts", 1, { dismissed_at: "t" }),
    ]);
    expect(m.get("x.ts")!.map((x) => x.id)).toEqual(["a", "c"]);
    expect(m.has("y.ts")).toBe(false);
  });
});

describe("resolveAnchors", () => {
  const lines = parsePatch("@@ -1,2 +1,3 @@\n ctx\n-old\n+new\n+added");
  // newNo: ctx=1, new=2, added=3
  it("anchors RIGHT-side lines and sends the rest to unanchored", () => {
    const { anchored, unanchored } = resolveAnchors(
      [mk("a", "x", 2), mk("b", "x", 3), mk("c", "x", 99)],
      lines,
    );
    expect([...anchored.keys()]).toEqual([2, 3]);
    expect(unanchored.map((x) => x.id)).toEqual(["c"]);
  });
  it("puts everything in unanchored when there is no patch", () => {
    const r = resolveAnchors([mk("a", "x", 1)], parsePatch(null));
    expect(r.anchored.size).toBe(0);
    expect(r.unanchored).toHaveLength(1);
  });
});
