/* UrlPanel — the "Import from URL" tab of AddSkillModal. Out of scope for
   now: fetching a remote URL server-side needs its own SSRF-safety design
   (see client/specs/skills.md's Import section), which doesn't exist yet.
   Shown as a real, selectable tab (matching the design) rather than a
   disabled one, with an explanation and a pointer to the working "From
   file" tab instead of silently doing nothing. */
"use client";

import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";

export function UrlPanel() {
  const t = useTranslations("skills");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: 12,
        padding: "48px 24px",
        color: "var(--text-secondary)",
      }}
    >
      <Icon.Link size={28} style={{ color: "var(--text-muted)" }} />
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
        {t("drawer.comingSoon.title")}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.5, maxWidth: 380 }}>{t("drawer.comingSoon.body")}</div>
    </div>
  );
}
