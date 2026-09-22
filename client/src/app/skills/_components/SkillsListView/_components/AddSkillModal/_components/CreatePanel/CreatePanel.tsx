/* CreatePanel — the "Create" tab of AddSkillModal (manual authoring).
   Ported from the former standalone CreateSkillModal; behavior unchanged:
   submit creates the skill (server always forces source: "manual") and
   navigates straight to its Config tab, closing the modal. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, FormField, TextInput, SelectInput, Textarea } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useCreateSkill } from "../../../../../../../../lib/hooks/skills";
import { DEFAULT_TYPE, TYPE_OPTIONS } from "../../constants";
import { s } from "./styles";

export function CreatePanel({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const create = useCreateSkill();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>(DEFAULT_TYPE);
  const [body, setBody] = React.useState("");

  const typeOptions = TYPE_OPTIONS.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));

  const submit = async () => {
    const skill = await create.mutateAsync({
      name: name.trim() || t("create.defaultName"),
      description,
      type,
      body,
    });
    onClose();
    router.push(`/skills/${skill.id}?tab=config`);
  };

  return (
    <>
      <div style={s.body}>
        <FormField label={t("create.fields.name")} required>
          <TextInput value={name} onChange={setName} placeholder={t("create.fields.namePlaceholder")} />
        </FormField>
        <FormField label={t("create.fields.description")}>
          <TextInput
            value={description}
            onChange={setDescription}
            placeholder={t("create.fields.descriptionPlaceholder")}
          />
        </FormField>
        <FormField label={t("create.fields.type")}>
          <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} mono={false} />
        </FormField>
        <FormField label={t("create.fields.body")}>
          <Textarea value={body} onChange={setBody} rows={8} mono placeholder={t("create.fields.bodyPlaceholder")} />
        </FormField>
      </div>
      <div style={s.footer}>
        <Button kind="primary" full disabled={create.isPending} onClick={submit}>
          {create.isPending ? t("create.creating") : t("create.create")}
        </Button>
      </div>
    </>
  );
}
