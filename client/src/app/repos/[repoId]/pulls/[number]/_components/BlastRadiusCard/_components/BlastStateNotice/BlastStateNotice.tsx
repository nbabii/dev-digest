"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Icon } from "@devdigest/ui";
import type { IconName } from "@devdigest/ui";
import type { BlastRadiusReport } from "@devdigest/shared";
import { NOTICE_FILES_COLLAPSED } from "../../constants";
import { noticeCount, noticeFiles } from "../../helpers";
import type { NoticeKey } from "../../helpers";
import { s } from "../../styles";

interface NoticeConfig {
  icon: IconName;
  warn?: boolean;
  /** Announced politely to assistive tech (in-flight work). */
  status?: boolean;
  reanalyze?: boolean;
}

const NOTICES: Record<NoticeKey, NoticeConfig> = {
  disabled: { icon: "Info" },
  notIndexed: { icon: "Database", reanalyze: true },
  indexing: { icon: "RefreshCw", status: true },
  reindexing: { icon: "RefreshCw", status: true },
  degraded: { icon: "AlertTriangle", warn: true, reanalyze: true },
  noChangedFiles: { icon: "Info" },
  noSymbols: { icon: "Info" },
  noSymbolTouched: { icon: "Info" },
  partial: { icon: "AlertTriangle", warn: true, reanalyze: true },
  factsIncomplete: { icon: "AlertTriangle", warn: true, reanalyze: true },
  zeroCallers: { icon: "Info" },
  zeroCallersIncomplete: { icon: "AlertTriangle", warn: true, reanalyze: true },
  uncovered: { icon: "Info" },
};

interface BlastStateNoticeProps {
  notice: NoticeKey;
  report: BlastRadiusReport;
  onReanalyze: () => void;
  reanalyzing: boolean;
}

export function BlastStateNotice({ notice, report, onReanalyze, reanalyzing }: BlastStateNoticeProps) {
  const t = useTranslations("blast");
  const cfg = NOTICES[notice];
  const NoticeIcon = Icon[cfg.icon];
  const count = noticeCount(notice, report);
  const files = noticeFiles(notice, report);
  const [expanded, setExpanded] = useState(false);
  const visibleFiles = expanded ? files : files.slice(0, NOTICE_FILES_COLLAPSED);
  const hiddenFiles = files.length - visibleFiles.length;
  return (
    <div role={cfg.status ? "status" : undefined} style={{ ...s.notice, ...(cfg.warn ? s.noticeWarn : null) }}>
      <NoticeIcon size={16} aria-hidden style={s.muted} />
      <div style={s.noticeBody}>
        <span style={s.noticeTitle}>{t(`state.${notice}.title`)}</span>
        <span>{t(`state.${notice}.body`, { count })}</span>
        {files.length > 0 && (
          <ul style={s.noticeFiles}>
            {visibleFiles.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
        {files.length > NOTICE_FILES_COLLAPSED && (
          <div>
            <Button kind="ghost" size="sm" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
              {expanded ? t("card.showFewerFiles") : t("card.showAllFiles", { count: hiddenFiles })}
            </Button>
          </div>
        )}
        {cfg.reanalyze && !report.index.indexing && (
          <div>
            <Button kind="ghost" size="sm" icon="RefreshCw" loading={reanalyzing} onClick={onReanalyze}>
              {reanalyzing ? t("card.reanalyzing") : t("card.reanalyze")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
