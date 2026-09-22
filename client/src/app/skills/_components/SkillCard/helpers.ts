import type { Skill } from "@devdigest/shared";

/** A skill from a non-manual source that hasn't been enabled yet still needs a
    human to read its body and vet it before it can affect a real review. */
export function needsVetting(skill: Skill): boolean {
  return skill.source !== "manual" && !skill.enabled;
}
