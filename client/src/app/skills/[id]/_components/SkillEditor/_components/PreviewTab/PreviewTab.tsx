"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { s } from "./styles";

/** Preview tab — renders `body` through the Markdown primitive, read-only,
    framed as "rendered as the reviewing agent receives it". */
export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("editor.tabs.preview")}</h2>
        <Badge color="var(--text-muted)">{t("preview.version", { version: skill.version })}</Badge>
        <Badge color={skill.enabled ? "var(--ok)" : "var(--text-muted)"}>
          {skill.enabled ? t("preview.enabled") : t("preview.disabled")}
        </Badge>
      </div>
      {skill.source !== "manual" && (
        <div style={s.notice}>
          <Icon.AlertTriangle size={16} style={{ flexShrink: 0, color: "var(--warn)" }} />
          <span>{t("preview.untrustedNotice")}</span>
        </div>
      )}
      <div style={s.card}>
        <Markdown>{skill.body}</Markdown>
      </div>
    </div>
  );
}
