/* SkillCard — icon, type chip, source badge, global enabled toggle, delete.
   Parallel to AgentCard (Skill-typed, hand-styled per feature) — not a reuse,
   the two entities don't share a shape. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useDeleteSkill, useUpdateSkill } from "../../../../lib/hooks/skills";
import { skillTypeColor } from "../../../../lib/skill-type-style";
import { SKILL_ICON } from "./constants";
import { needsVetting } from "./helpers";
import { s } from "./styles";

export function SkillCard({ skill, active, onClick }: { skill: Skill; active?: boolean; onClick?: () => void }) {
  const t = useTranslations("skills");
  const del = useDeleteSkill();
  const update = useUpdateSkill();
  const Ic = Icon[SKILL_ICON];
  const { color, bg } = skillTypeColor(skill.type);
  const vetting = needsVetting(skill);

  return (
    <div onClick={onClick} style={s.card(!!active, skill.enabled)}>
      <div style={s.headerRow}>
        <div style={s.iconBox(color, bg)}>
          <Ic size={15} />
        </div>
        <span style={s.name}>{skill.name}</span>
        <div onClick={(e) => e.stopPropagation()}>
          <Toggle
            on={skill.enabled}
            onChange={(enabled) => update.mutate({ id: skill.id, patch: { enabled } })}
            size={14}
          />
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`Delete skill "${skill.name}"? This cannot be undone.`)) del.mutate(skill.id);
          }}
          disabled={del.isPending}
          title="Delete skill"
          aria-label="Delete skill"
          style={s.deleteBtn(del.isPending)}
        >
          <Icon.Trash size={14} style={del.isPending ? { animation: "ddspin 1s linear infinite" } : undefined} />
        </button>
      </div>
      <div style={s.description}>{skill.description || t("listItem.noDescription")}</div>
      <div style={s.metaRow}>
        <Badge color={color} bg={bg}>{t(`listItem.type.${skill.type}`)}</Badge>
        <Badge color="var(--text-muted)">{t(`listItem.source.${skill.source}`)}</Badge>
        {vetting && (
          <span title={t("listItem.vettingTitle")}>
            <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
              {t("listItem.needsVetting")}
            </Badge>
          </span>
        )}
      </div>
      <div style={s.statsRow}>
        <span>{t("listItem.agentCount", { count: skill.agent_count })}</span>
        <span>{t("listItem.version", { version: skill.version })}</span>
      </div>
    </div>
  );
}
