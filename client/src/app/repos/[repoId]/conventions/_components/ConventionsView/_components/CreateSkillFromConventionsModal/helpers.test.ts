import { describe, it, expect } from "vitest";
import type { ConventionCandidate } from "@devdigest/shared";
import { slugify, repoSlug, buildMergedBody } from "./helpers";

const CANDIDATE: ConventionCandidate = {
  id: "c1",
  scan_id: "s1",
  repo_id: "r1",
  category: "error-handling",
  rule: "Always use async/await instead of .then() chains",
  evidence_path: "src/api/users.ts",
  evidence_line_start: 23,
  evidence_line_end: 31,
  evidence_snippet: "const user = await db.users.find(id);",
  confidence: 0.91,
  status: "accepted",
  created_at: "2026-09-20T00:00:00.000Z",
};

describe("slugify / repoSlug", () => {
  it("lowercases and dashes non-alphanumeric runs", () => {
    expect(slugify("Always use async/await!")).toBe("always-use-async-await");
  });

  it("derives the last path segment of a full repo name", () => {
    expect(repoSlug("acme/payments-api")).toBe("payments-api");
  });
});

describe("buildMergedBody", () => {
  it("includes a title, one heading per candidate, and its evidence citation", () => {
    const body = buildMergedBody("acme/payments-api", [CANDIDATE]);
    expect(body).toContain("# payments-api-conventions");
    expect(body).toContain("## always-use-async-await-instead-of-then-chains");
    expect(body).toContain(CANDIDATE.rule);
    expect(body).toContain("Detected in `src/api/users.ts:23-31`");
    expect(body).toContain(CANDIDATE.evidence_snippet);
  });

  it("emits only the given candidates, in order — excluded ones never appear", () => {
    const other: ConventionCandidate = { ...CANDIDATE, id: "c2", rule: "Rejected rule" };
    const body = buildMergedBody("acme/payments-api", [CANDIDATE]);
    expect(body).not.toContain(other.rule);
  });
});
