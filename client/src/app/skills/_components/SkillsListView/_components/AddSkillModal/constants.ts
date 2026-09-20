import type { SkillType } from "@devdigest/shared";

/** Which tab of the "Add skill" modal is active. */
export type AddSkillTab = "create" | "file" | "url";

/** Modal width (px) — same as the former CreateSkillModal/ImportSkillDrawer. */
export const ADD_SKILL_MODAL_WIDTH = 620;

/** Default type for a new (manually-authored) skill. */
export const DEFAULT_TYPE: SkillType = "convention";

/** Selectable types — shared by the Create and From-file (preview/confirm) panels. */
export const TYPE_OPTIONS: readonly SkillType[] = ["rubric", "convention", "security", "custom"];
