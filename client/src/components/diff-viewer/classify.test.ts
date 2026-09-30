import { describe, it, expect } from "vitest";
import type { PrFile } from "@/lib/types";
import { classifyFile, groupFiles, type FileRole } from "./classify";

const f = (path: string): PrFile => ({ path, additions: 1, deletions: 0, patch: "" }) as PrFile;

describe("classifyFile", () => {
  const cases: [string, FileRole][] = [
    ["pnpm-lock.yaml", "boilerplate"],
    ["client/package-lock.json", "boilerplate"],
    ["src/__snapshots__/a.txt", "boilerplate"],
    ["src/foo.test.ts.snap", "boilerplate"],
    ["src/foo.test.ts", "tests"],
    ["src/foo.spec.tsx", "tests"],
    ["e2e/specs/a.json", "tests"],
    ["README.md", "docs"],
    ["LICENSE", "docs"],
    ["src/index.ts", "wiring"],
    ["vite.config.ts", "wiring"],
    ["package.json", "wiring"],
    [".github/workflows/ci.yml", "wiring"],
    ["src/config.ts", "core"], // no dot before "config" -> not wiring
    ["src/app/page.tsx", "core"],
    // precedence
    ["docs/x.test.ts", "tests"],
    ["dist/index.ts", "boilerplate"],
    ["e2e/CLAUDE.md", "docs"],
    ["e2e/specs/README.md", "docs"],
    ["tests/README.md", "docs"],
    ["e2e/specs/05-pr-diff.flow.json", "tests"], // via test dir
    ["dist/foo.md", "boilerplate"],
    ["src/foo.spec.ts", "tests"],
  ];
  it.each(cases)("%s -> %s", (path, role) => {
    expect(classifyFile(path)).toBe(role);
  });
});

describe("groupFiles", () => {
  it("orders groups core->boilerplate, keeps input order inside, omits empty groups", () => {
    const files = ["pnpm-lock.yaml", "b.ts", "a.test.ts", "README.md", "a.ts", "src/index.ts"].map(f);
    const groups = groupFiles(files);
    expect(groups.map((g) => g.role)).toEqual(["core", "tests", "wiring", "docs", "boilerplate"]);
    expect(groups[0]!.files.map((x) => x.path)).toEqual(["b.ts", "a.ts"]);
    expect(groupFiles([f("a.ts"), f("x.lock")]).map((g) => g.role)).toEqual(["core", "boilerplate"]);
    expect(groupFiles([])).toEqual([]);
  });

  it("puts e2e/CLAUDE.md in the docs group, not tests", () => {
    const groups = groupFiles([f("e2e/CLAUDE.md"), f("e2e/specs/a.flow.json")]);
    expect(groups.map((g) => g.role)).toEqual(["tests", "docs"]);
    expect(groups.find((g) => g.role === "docs")!.files.map((x) => x.path)).toEqual(["e2e/CLAUDE.md"]);
  });
});
