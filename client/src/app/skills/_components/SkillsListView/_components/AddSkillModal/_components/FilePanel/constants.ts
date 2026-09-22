/** Constants for FilePanel — the "From file" tab's 3-sub-step wizard
    (Upload → Preview → Confirm), the only import method this feature ships
    (URL fetch has no server-side SSRF-safe implementation yet). */

export type ImportStep = "upload" | "preview" | "confirm" | "done";

/** ExportWizardSteps is 0-indexed; "done" has no dedicated dot (the panel
    shows a success state instead of the stepper at that point). */
export const STEP_INDEX: Record<Exclude<ImportStep, "done">, number> = {
  upload: 0,
  preview: 1,
  confirm: 2,
};

/** Accepted upload extensions — markdown/text (used as-is) or a zip archive
    (only .md/.txt entries inside are ever read). */
export const ACCEPT = ".md,.txt,.zip";
