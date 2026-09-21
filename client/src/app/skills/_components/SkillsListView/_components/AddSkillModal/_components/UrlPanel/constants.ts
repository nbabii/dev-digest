/** Constants for UrlPanel — the "Import from URL" tab's 3-sub-step wizard
    (URL entry -> Preview -> Confirm). Structurally parallel to
    FilePanel/constants.ts, not shared — see client/specs/skill-url-import.md. */

export type ImportStep = "url" | "preview" | "confirm" | "done";

/** ExportWizardSteps is 0-indexed; "done" has no dedicated dot (the panel
    shows a success state instead of the stepper at that point). */
export const STEP_INDEX: Record<Exclude<ImportStep, "done">, number> = {
  url: 0,
  preview: 1,
  confirm: 2,
};
