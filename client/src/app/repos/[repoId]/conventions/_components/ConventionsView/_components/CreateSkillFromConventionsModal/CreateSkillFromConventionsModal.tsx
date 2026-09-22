/* CreateSkillFromConventionsModal — client-only bundling step: merges the
   accepted candidates into one skill body and POSTs to the EXISTING
   /skills/import confirm route (server/specs/conventions-extractor.md — no
   new server route for skill creation). No Enabled toggle: the server
   always forces enabled:false on this path (server/specs/skills.md Trust
   model), so a toggle here would silently be ignored. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Modal, Button, FormField, TextInput, Textarea, SelectInput } from "@devdigest/ui";
import type { ConventionCandidate, SkillType } from "@devdigest/shared";
import { useConfirmSkillImport } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { buildMergedBody, repoSlug } from "./helpers";
import { s } from "./styles";

const TYPE_OPTIONS: readonly SkillType[] = ["rubric", "convention", "security", "custom"];

export function CreateSkillFromConventionsModal({
  repoName,
  candidates,
  onClose,
}: {
  repoName: string;
  candidates: ConventionCandidate[];
  onClose: () => void;
}) {
  const t = useTranslations("conventions");
  const tSkills = useTranslations("skills");
  const router = useRouter();
  const toast = useToast();
  const confirmImport = useConfirmSkillImport();

  const [name, setName] = React.useState(`${repoSlug(repoName)}-conventions`);
  const [description, setDescription] = React.useState(
    t("modal.defaultDescription", { count: candidates.length, repo: repoName }),
  );
  const [type, setType] = React.useState<SkillType>("convention");
  const [body, setBody] = React.useState(() => buildMergedBody(repoName, candidates));

  const tokenEstimate = Math.max(1, Math.round(body.length / 4));
  const evidenceFiles = [...new Set(candidates.map((c) => c.evidence_path))];

  const submit = async () => {
    const skill = await confirmImport.mutateAsync({
      name: name.trim() || `${repoSlug(repoName)}-conventions`,
      description,
      type,
      body,
      source: "extracted",
      evidence_files: evidenceFiles,
    });
    onClose();
    toast.success(t("modal.success", { name: skill.name }));
    router.push(`/skills/${skill.id}`);
  };

  const typeOptions = TYPE_OPTIONS.map((v) => ({ value: v, label: tSkills(`listItem.type.${v}`) }));

  return (
    <Modal width={720} title={t("modal.title")} onClose={onClose}>
      <div style={s.body}>
        <div style={s.banner}>
          {t("modal.mergedFrom", { count: candidates.length, repo: repoName })}
        </div>
        <FormField label={t("modal.fields.name")} required>
          <TextInput value={name} onChange={setName} />
        </FormField>
        <FormField label={t("modal.fields.description")}>
          <TextInput value={description} onChange={setDescription} />
        </FormField>
        <FormField label={t("modal.fields.type")}>
          <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} mono={false} />
        </FormField>
        <FormField label={`${t("modal.fields.body")} · ${tokenEstimate} tokens`} required>
          <Textarea value={body} onChange={setBody} rows={14} mono />
        </FormField>
      </div>
      <div style={s.footer}>
        <Button kind="secondary" onClick={onClose} disabled={confirmImport.isPending}>
          {t("modal.cancel")}
        </Button>
        <Button
          kind="primary"
          icon="Sparkles"
          disabled={confirmImport.isPending || !name.trim() || !body.trim()}
          onClick={submit}
        >
          {confirmImport.isPending ? t("modal.creating") : t("modal.create")}
        </Button>
      </div>
    </Modal>
  );
}
