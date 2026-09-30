/* DiffViewer — basic GitHub-style unified diff viewer. Renders real PrFile.patch
   (unified-diff text from the F1 API) as a list of collapsible FileCards.
   Optional inline comments (Files changed tab): hover a line → "+" → comment,
   posted live to GitHub; existing GitHub review comments render inline.
   Optional Smart Diff: `order="smart"` groups files by role; `findings` +
   `renderFinding` surface review findings inline (renderFinding is supplied by
   the page so this shared component never imports from `app/`). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import type { PrFile } from "@/lib/types";
import { type DiffCommentApi } from "../comments";
import { groupFiles } from "../classify";
import { mapFindingsToFiles } from "../findings";
import { s, fs } from "../styles";
import { FileCard } from "../FileCard";
import { FileGroup } from "../FileGroup";

export type DiffOrder = "smart" | "original";

export function DiffViewer({
  files,
  commenting,
  findings,
  renderFinding,
  order = "original",
}: {
  files: PrFile[];
  commenting?: DiffCommentApi;
  findings?: FindingRecord[];
  renderFinding?: (f: FindingRecord) => React.ReactNode;
  order?: DiffOrder;
}) {
  const t = useTranslations("shell");
  const findingsByFile = React.useMemo(
    () => (renderFinding && findings ? mapFindingsToFiles(findings) : undefined),
    [findings, renderFinding],
  );
  const groups = React.useMemo(() => (order === "smart" ? groupFiles(files ?? []) : []), [order, files]);

  if (!files || files.length === 0) {
    return <div style={s.empty}>{t("diffViewer.noChangedFiles")}</div>;
  }
  if (order === "smart") {
    return (
      <div style={fs.groups}>
        {groups.map((g) => (
          <FileGroup
            key={g.role}
            role={g.role}
            files={g.files}
            findingsByFile={findingsByFile}
            renderFinding={renderFinding}
            commenting={commenting}
          />
        ))}
      </div>
    );
  }
  return (
    <div style={s.list}>
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
  );
}
