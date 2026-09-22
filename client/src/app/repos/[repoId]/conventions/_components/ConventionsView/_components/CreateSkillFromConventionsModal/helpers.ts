import type { ConventionCandidate } from "@devdigest/shared";

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** repo full_name ("acme/payments-api") -> a short slug for the default skill name. */
export function repoSlug(repoName: string): string {
  return slugify(repoName.split("/").pop() ?? repoName);
}

/** Merge accepted candidates into one skill body markdown — matches the
    mockup's "# <repo>-conventions" / "## <rule-slug>" / evidence layout. */
export function buildMergedBody(repoName: string, candidates: ConventionCandidate[]): string {
  const title = `${repoSlug(repoName)}-conventions`;
  const sections = candidates.map((c) => {
    const heading = slugify(c.rule) || c.category;
    return [
      `## ${heading}`,
      c.rule,
      "",
      `Detected in \`${c.evidence_path}:${c.evidence_line_start}-${c.evidence_line_end}\`:`,
      "```",
      c.evidence_snippet,
      "```",
    ].join("\n");
  });
  return [`# ${title}`, "", ...sections].join("\n\n");
}
