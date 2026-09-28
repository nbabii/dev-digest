/** Pure file-role classifier + grouping for the Smart Diff view (framework-free). */
import type { PrFile } from "@/lib/types";

export type FileRole = "core" | "tests" | "wiring" | "docs" | "boilerplate";

/** Display order of the groups. */
export const ROLE_ORDER: readonly FileRole[] = ["core", "tests", "wiring", "docs", "boilerplate"];

const LOCK_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "cargo.lock",
  "gemfile.lock",
  "poetry.lock",
  "composer.lock",
  "go.sum",
]);

const hasDir = (segs: string[], names: string[]) => segs.slice(0, -1).some((d) => names.includes(d));

function isBoilerplate(segs: string[], base: string): boolean {
  return (
    LOCK_FILES.has(base) ||
    base.endsWith(".lock") ||
    base.endsWith(".snap") ||
    /\.generated\./.test(base) ||
    /\.min\./.test(base) ||
    hasDir(segs, ["__snapshots__", "generated", "dist"])
  );
}

const isTestFile = (base: string) => /\.(test|spec)\./.test(base);

const isTestDir = (segs: string[]) => hasDir(segs, ["test", "tests", "__tests__", "e2e"]);

function isDocs(segs: string[], base: string): boolean {
  return /\.mdx?$/.test(base) || /^license(\.|$)/.test(base) || hasDir(segs, ["docs"]);
}

function isWiring(segs: string[], base: string, path: string): boolean {
  return (
    /^index\.(ts|tsx|js|jsx|mjs|cjs)$/.test(base) ||
    /\.config\./.test(base) ||
    base === "package.json" ||
    base.startsWith("tsconfig") ||
    base.startsWith(".env") ||
    base === "dockerfile" ||
    base.startsWith("dockerfile.") ||
    base === ".gitlab-ci.yml" ||
    path.startsWith(".github/workflows/") ||
    path.startsWith(".circleci/")
  );
}

/**
 * Classify by path. Precedence: boilerplate, test file names (*.test.*, *.spec.*),
 * docs (*.md, *.mdx, docs/, LICENSE), test directories (test/, tests/, __tests__/, e2e/),
 * wiring, core (default). Docs beat test dirs so `e2e/CLAUDE.md` is docs; a test file name
 * still beats docs/ so `docs/x.test.ts` stays tests.
 */
export function classifyFile(path: string): FileRole {
  const lower = path.toLowerCase();
  const segs = lower.split("/");
  const base = segs[segs.length - 1] ?? lower;
  if (isBoilerplate(segs, base)) return "boilerplate";
  if (isTestFile(base)) return "tests";
  if (isDocs(segs, base)) return "docs";
  if (isTestDir(segs)) return "tests";
  if (isWiring(segs, base, lower)) return "wiring";
  return "core";
}

/** Stable bucket by role; keeps input (GitHub) order inside each group. Empty groups are omitted. */
export function groupFiles(files: PrFile[]): { role: FileRole; files: PrFile[] }[] {
  const buckets = new Map<FileRole, PrFile[]>();
  for (const f of files) {
    const role = classifyFile(f.path);
    const list = buckets.get(role);
    if (list) list.push(f);
    else buckets.set(role, [f]);
  }
  return ROLE_ORDER.filter((r) => buckets.has(r)).map((role) => ({ role, files: buckets.get(role)! }));
}
