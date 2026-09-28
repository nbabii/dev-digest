/* UnanchoredFindings — footer list for findings whose line isn't in the patch
   (or the file has no patch). Never dropped. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import { fs } from "../styles";

export function UnanchoredFindings({
  findings,
  renderFinding,
}: {
  findings: FindingRecord[];
  renderFinding: (f: FindingRecord) => React.ReactNode;
}) {
  const t = useTranslations("shell");
  if (findings.length === 0) return null;
  return (
    <div style={fs.unanchoredWrap}>
      <span style={fs.unanchoredTitle}>{t("diffViewer.unanchoredTitle", { count: findings.length })}</span>
      {findings.map((f) => (
        <React.Fragment key={f.id}>{renderFinding(f)}</React.Fragment>
      ))}
    </div>
  );
}
