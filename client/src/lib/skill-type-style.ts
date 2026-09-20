import type { SkillType } from "@devdigest/shared";

/** Shared SkillType → color mapping. Used by both the Skills list's
    SkillCard (icon background/color) and the Agent editor's Skills tab
    (type badge) so a skill's type reads as the same color everywhere,
    regardless of which list it's rendered in. Promoted here on its second
    use rather than colocated under either feature. */
export interface SkillTypeColor {
  color: string;
  bg: string;
}

const SKILL_TYPE_COLOR: Record<SkillType, SkillTypeColor> = {
  rubric: { color: "var(--accent)", bg: "var(--accent-bg)" },
  convention: { color: "var(--ok)", bg: "var(--ok-bg)" },
  security: { color: "var(--crit)", bg: "var(--crit-bg)" },
  custom: { color: "var(--info)", bg: "var(--info-bg)" },
};

export function skillTypeColor(type: SkillType): SkillTypeColor {
  return SKILL_TYPE_COLOR[type];
}
