/* FilePanel — the "From file" tab of AddSkillModal. Ported from the former
   standalone ImportSkillDrawer (a side drawer); behavior unchanged, only the
   outer container changed (now a tab's content instead of a Drawer).

   Upload → Preview → Confirm, via ExportWizardSteps. Preview calls
   POST /skills/import/preview (nothing persisted yet); Confirm calls
   POST /skills/import (never useCreateSkill — that route can only ever
   produce a "manual" skill, see hooks/skills.ts). The server always creates
   the row `enabled: false`; the confirm success state says so. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ExportWizardSteps, FormField, Icon, SelectInput, TextInput, Textarea } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import {
  useConfirmSkillImport,
  useImportSkillPreview,
  type ImportedSkillSource,
  type IgnoredZipEntry,
} from "../../../../../../../../lib/hooks/skills";
import { TYPE_OPTIONS } from "../../constants";
import { ACCEPT, STEP_INDEX, type ImportStep } from "./constants";
import { isZipFile } from "./helpers";
import { s } from "./styles";

interface EditableFields {
  name: string;
  description: string;
  type: SkillType;
  body: string;
}

export function FilePanel({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const preview = useImportSkillPreview();
  const confirm = useConfirmSkillImport();

  const [step, setStep] = React.useState<ImportStep>("upload");
  const [file, setFile] = React.useState<File | null>(null);
  const [fields, setFields] = React.useState<EditableFields | null>(null);
  const [source, setSource] = React.useState<ImportedSkillSource | null>(null);
  const [ignored, setIgnored] = React.useState<IgnoredZipEntry[]>([]);
  const [createdSkill, setCreatedSkill] = React.useState<{ id: string; name: string } | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const typeOptions = TYPE_OPTIONS.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));

  const runPreview = async () => {
    if (!file) return;
    try {
      const result = await preview.mutateAsync(file);
      setFields({ name: result.name, description: result.description, type: result.type, body: result.body });
      setSource(result.source);
      setIgnored(result.ignored ?? []);
      setStep("preview");
    } catch {
      // surfaced inline below via preview.isError/preview.error
    }
  };

  const runConfirm = async () => {
    if (!fields || !source) return;
    try {
      const skill = await confirm.mutateAsync({
        name: fields.name,
        description: fields.description,
        type: fields.type,
        body: fields.body,
        source,
      });
      setCreatedSkill({ id: skill.id, name: skill.name });
      setStep("done");
    } catch {
      // surfaced inline below via confirm.isError/confirm.error
    }
  };

  const viewSkill = () => {
    if (!createdSkill) return;
    onClose();
    router.push(`/skills/${createdSkill.id}?tab=config`);
  };

  return (
    <>
      <div style={s.body}>
        {step !== "done" && (
          <div style={s.stepsBar}>
            <ExportWizardSteps
              step={STEP_INDEX[step]}
              labels={[t("file.steps.upload"), t("file.steps.preview"), t("file.steps.confirm")]}
            />
          </div>
        )}

        {step === "upload" && (
          <>
            <div style={s.uploadZone}>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT}
                style={{ display: "none" }}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <Button kind="secondary" icon="Upload" onClick={() => fileInputRef.current?.click()}>
                {t("file.chooseFile")}
              </Button>
              {file && <span style={s.selectedFile}>{t("file.selectedFile", { name: file.name })}</span>}
              <span style={s.hint}>{t("file.chooseFileHint")}</span>
            </div>
            {preview.isError && (
              <div style={s.errorText}>
                {t("file.previewError")} {preview.error instanceof Error ? preview.error.message : ""}
              </div>
            )}
          </>
        )}

        {step === "preview" && fields && (
          <>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>{t("file.previewTitle")}</h3>
            <div style={s.section}>
              <div style={s.sectionLabel}>{t("create.fields.name")}</div>
              <div style={s.readonlyValue}>{fields.name || "—"}</div>
            </div>
            <div style={s.section}>
              <div style={s.sectionLabel}>{t("file.descriptionLabel")}</div>
              <div style={s.readonlyValue}>{fields.description || "—"}</div>
            </div>
            <div style={s.section}>
              <div style={s.sectionLabel}>{t("file.typeLabel")}</div>
              <div style={s.readonlyValue}>{t(`listItem.type.${fields.type}`)}</div>
            </div>
            <div style={s.section}>
              <div style={s.sectionLabel}>{t("file.bodyLabel")}</div>
              <pre className="mono" style={s.bodyPreview}>
                {fields.body || "—"}
              </pre>
            </div>
            {isZipFile(file) && (
              <div style={s.section}>
                <div style={s.sectionLabel}>{t("file.ignoredEntries")}</div>
                {ignored.length === 0 ? (
                  <div style={s.hint}>{t("file.noIgnoredEntries")}</div>
                ) : (
                  <ul style={s.ignoredList}>
                    {ignored.map((entry) => (
                      <li key={entry.path} style={s.ignoredEntry}>
                        <Icon.Slash size={12} />
                        <span className="mono">{entry.path}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}

        {step === "confirm" && fields && (
          <>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>{t("file.confirmTitle")}</h3>
            <div style={s.notice}>
              <Icon.AlertTriangle size={16} style={{ flexShrink: 0, color: "var(--warn)" }} />
              <span>{t("preview.untrustedNotice")}</span>
            </div>
            <FormField label={t("file.nameLabel")} hint={t("file.nameHint")}>
              <TextInput value={fields.name} onChange={(v) => setFields({ ...fields, name: v })} />
            </FormField>
            <FormField label={t("file.descriptionLabel")}>
              <TextInput value={fields.description} onChange={(v) => setFields({ ...fields, description: v })} />
            </FormField>
            <FormField label={t("file.typeLabel")}>
              <SelectInput
                value={fields.type}
                onChange={(v) => setFields({ ...fields, type: v as SkillType })}
                options={typeOptions}
                mono={false}
              />
            </FormField>
            <FormField label={t("file.bodyLabel")} hint={t("file.bodyHint")}>
              <Textarea value={fields.body} onChange={(v) => setFields({ ...fields, body: v })} rows={10} mono />
            </FormField>
            {confirm.isError && (
              <div style={s.errorText}>
                {t("drawer.importFailed")} {confirm.error instanceof Error ? confirm.error.message : ""}
              </div>
            )}
          </>
        )}

        {step === "done" && createdSkill && (
          <div style={s.done}>
            <Icon.CheckCircle size={36} style={{ color: "var(--ok)" }} />
            <div style={{ fontSize: 15 }}>{t("url.success", { name: createdSkill.name })}</div>
            <Button kind="primary" icon="ArrowRight" onClick={viewSkill}>
              {t("file.viewSkill")}
            </Button>
          </div>
        )}
      </div>

      {step !== "done" && (
        <div style={s.footer}>
          {step === "upload" && (
            <Button kind="primary" iconRight="ArrowRight" onClick={runPreview} disabled={!file || preview.isPending}>
              {preview.isPending ? t("file.previewing") : t("file.continue")}
            </Button>
          )}
          {step === "preview" && (
            <>
              <Button kind="ghost" onClick={() => setStep("upload")}>
                {t("file.back")}
              </Button>
              <Button kind="primary" iconRight="ArrowRight" onClick={() => setStep("confirm")}>
                {t("file.continue")}
              </Button>
            </>
          )}
          {step === "confirm" && (
            <>
              <Button kind="ghost" onClick={() => setStep("preview")}>
                {t("file.back")}
              </Button>
              <Button kind="primary" icon="Upload" onClick={runConfirm} disabled={confirm.isPending}>
                {confirm.isPending ? t("file.importing") : t("file.import")}
              </Button>
            </>
          )}
        </div>
      )}
    </>
  );
}
