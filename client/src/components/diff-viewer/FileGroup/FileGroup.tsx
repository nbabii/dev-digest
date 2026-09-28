/* FileGroup — one Smart Diff role group: header (colour square, label,
   description, findings count, "N files") and its FileCards. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import type { PrFile } from "@/lib/types";
import type { FileRole } from "../classify";
import { COLLAPSED_ROLES, ROLE_COLOR } from "../constants";
import type { DiffCommentApi } from "../comments";
import { s, fs, roleSquare } from "../styles";
import { FileCard } from "../FileCard";

const ROLE_KEY = {
  core: "Core",
  tests: "Tests",
  wiring: "Wiring",
  docs: "Docs",
  boilerplate: "Boilerplate",
} as const satisfies Record<FileRole, string>;

export function FileGroup({
  role,
  files,
  findingsByFile,
  renderFinding,
  commenting,
}: {
  role: FileRole;
  files: PrFile[];
  findingsByFile?: Map<string, FindingRecord[]>;
  renderFinding?: (f: FindingRecord) => React.ReactNode;
  commenting?: DiffCommentApi;
}) {
  const t = useTranslations("shell");
  const [userOpen, setUserOpen] = React.useState<boolean | null>(null);
  const filesWithFindings = renderFinding
    ? files.filter((f) => (findingsByFile?.get(f.path)?.length ?? 0) > 0).length
    : 0;
  const defaultOpen = !COLLAPSED_ROLES.has(role);
  const open = userOpen ?? (defaultOpen || filesWithFindings > 0);
  const key = ROLE_KEY[role];

  return (
    <section aria-label={t(`diffViewer.group${key}`)}>
      <button type="button" aria-expanded={open} onClick={() => setUserOpen(!open)} style={fs.groupHeader}>
        <span style={roleSquare(ROLE_COLOR[role])} />
        <span style={fs.groupLabel}>{t(`diffViewer.group${key}`)}</span>
        <span style={fs.groupDesc}>{t(`diffViewer.group${key}Desc`)}</span>
        {filesWithFindings > 0 && (
          <span style={fs.groupFindings} title={t("diffViewer.groupFindings", { count: filesWithFindings })}>
            <span style={fs.dot} />
            {filesWithFindings}
          </span>
        )}
        <span style={fs.groupMeta}>{t("diffViewer.filesCount", { count: files.length })}</span>
      </button>
      {open && (
        <div style={fs.groupFiles}>
          {files.map((f) => (
            <FileCard
              key={f.path}
              file={f}
              commenting={commenting}
              findings={findingsByFile?.get(f.path)}
              renderFinding={renderFinding}
            />
          ))}
        </div>
      )}
    </section>
  );
}
