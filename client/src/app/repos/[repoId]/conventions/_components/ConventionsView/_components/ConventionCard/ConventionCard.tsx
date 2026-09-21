/* ConventionCard — one candidate: evidence, confidence, accept/reject,
   inline rule edit. See client/specs/conventions-extractor.md. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, IconBtn, PercentProgress } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { s } from "./styles";

export function ConventionCard({
  candidate,
  onAccept,
  onReject,
  onEditRule,
}: {
  candidate: ConventionCandidate;
  onAccept: () => void;
  onReject: () => void;
  onEditRule: (rule: string) => void;
}) {
  const t = useTranslations("conventions");
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(candidate.rule);

  const commitEdit = () => {
    setEditing(false);
    onEditRule(draft);
  };

  return (
    <div style={s.card(candidate.status)}>
      <div style={s.headerRow}>
        {editing ? (
          <input
            autoFocus
            style={s.ruleInput}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") {
                setDraft(candidate.rule);
                setEditing(false);
              }
            }}
          />
        ) : (
          <span
            style={s.rule}
            onClick={() => setEditing(true)}
            role="button"
            tabIndex={0}
            aria-label={t("card.editRule")}
          >
            {candidate.rule}
          </span>
        )}
        <div style={s.actions}>
          <Button
            kind={candidate.status === "accepted" ? "primary" : "secondary"}
            size="sm"
            icon="Check"
            onClick={onAccept}
          >
            {candidate.status === "accepted" ? t("card.accepted") : t("card.acceptAsSkill")}
          </Button>
          <Button
            kind={candidate.status === "rejected" ? "danger" : "secondary"}
            size="sm"
            icon="X"
            onClick={onReject}
          >
            {candidate.status === "rejected" ? t("card.rejected") : t("card.reject")}
          </Button>
        </div>
      </div>

      <div style={s.evidenceBox}>
        <div style={s.evidenceHeader}>
          <span style={{ flex: 1 }}>
            {candidate.evidence_path}:{candidate.evidence_line_start}-{candidate.evidence_line_end}
          </span>
          <IconBtn
            icon="Copy"
            label="Copy path"
            size={22}
            onClick={() => navigator.clipboard?.writeText(candidate.evidence_path).catch(() => {})}
          />
        </div>
        <pre style={s.evidenceSnippet}>{candidate.evidence_snippet}</pre>
      </div>

      <div style={s.confidenceRow}>
        <PercentProgress value={candidate.confidence * 100} label={t("card.confidence")} />
      </div>
    </div>
  );
}
