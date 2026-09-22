/* UrlPanel — the "Import from URL" tab of AddSkillModal. Structurally a
   copy of FilePanel's 3-sub-step wizard (URL entry -> Preview -> Confirm),
   not a new pattern — see client/specs/skill-url-import.md for why. Preview
   calls POST /skills/import/url-preview (nothing persisted yet — see
   server/specs/skill-url-import.md for the fetch/SSRF-safety design);
   Confirm reuses the EXISTING POST /skills/import route/hook unchanged,
   same as FilePanel's. The server always creates the row `enabled: false`;
   the confirm success state says so (reusing the same `url.success` copy
   FilePanel's own done state already reuses today). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ExportWizardSteps, FormField, Icon, SelectInput, TextInput, Textarea } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import {
  useConfirmSkillImport,
  useImportUrlPreview,
  type ImportedSkillSource,
} from "../../../../../../../../lib/hooks/skills";
import { TYPE_OPTIONS } from "../../constants";
import { STEP_INDEX, type ImportStep } from "./constants";
import { s } from "./styles";

interface EditableFields {
  name: string;
  description: string;
  type: SkillType;
  body: string;
}

function looksHttps(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function UrlPanel({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const preview = useImportUrlPreview();
  const confirm = useConfirmSkillImport();

  const [step, setStep] = React.useState<ImportStep>("url");
  const [url, setUrl] = React.useState("");
  const [fields, setFields] = React.useState<EditableFields | null>(null);
  const [source, setSource] = React.useState<ImportedSkillSource | null>(null);
  const [createdSkill, setCreatedSkill] = React.useState<{ id: string; name: string } | null>(null);

  const typeOptions = TYPE_OPTIONS.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));

  const runPreview = async () => {
    if (!looksHttps(url)) return;
    try {
      const result = await preview.mutateAsync(url);
      setFields({ name: result.name, description: result.description, type: result.type, body: result.body });
      setSource(result.source);
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
              labels={[t("url.steps.url"), t("file.steps.preview"), t("file.steps.confirm")]}
            />
          </div>
        )}

        {step === "url" && (
          <>
            <FormField label={t("url.label")} hint={t("url.hint")}>
              <TextInput value={url} onChange={setUrl} placeholder={t("url.placeholder")} />
            </FormField>
            {preview.isError && (
              <div style={s.errorText}>
                {t("url.fetchError")} {preview.error instanceof Error ? preview.error.message : ""}
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
          {step === "url" && (
            <Button
              kind="primary"
              iconRight="ArrowRight"
              onClick={runPreview}
              disabled={!looksHttps(url) || preview.isPending}
            >
              {preview.isPending ? t("url.fetching") : t("file.continue")}
            </Button>
          )}
          {step === "preview" && (
            <>
              <Button kind="ghost" onClick={() => setStep("url")}>
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
                {confirm.isPending ? t("file.importing") : t("url.import")}
              </Button>
            </>
          )}
        </div>
      )}
    </>
  );
}
