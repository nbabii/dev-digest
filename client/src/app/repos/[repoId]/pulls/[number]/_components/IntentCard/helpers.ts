import type { IntentSource } from "@devdigest/shared";

const STATIC_LABEL: Partial<Record<IntentSource["kind"], string>> = {
  pr_description: "PR description",
  changed_files: "changed files",
};

/** Compact, human-readable summary of an Intent's `sources`, e.g.
    "PR description, linked issue #42, 1 doc (unreachable)". Linked docs are
    aggregated into a single count (there can be up to 3) rather than listed
    individually, per the plan's "compact sources caption" spec. */
export function sourcesCaption(sources: IntentSource[]): string {
  const docs = sources.filter((source) => source.kind === "linked_doc");
  const others = sources.filter((source) => source.kind !== "linked_doc");

  const parts = others.map(describeSource);

  if (docs.length > 0) {
    const unreachable = docs.some((doc) => doc.status === "unreachable");
    const label = `${docs.length} ${docs.length === 1 ? "doc" : "docs"}`;
    parts.push(unreachable ? `${label} (unreachable)` : label);
  }

  return parts.join(", ");
}

function describeSource(source: IntentSource): string {
  const label =
    source.kind === "linked_issue" ? `linked issue ${formatIssueRef(source.ref)}` : STATIC_LABEL[source.kind];
  return source.status === "used" ? (label ?? source.kind) : `${label ?? source.kind} (${source.status})`;
}

function formatIssueRef(ref: string): string {
  return /^\d+$/.test(ref) ? `#${ref}` : ref;
}
