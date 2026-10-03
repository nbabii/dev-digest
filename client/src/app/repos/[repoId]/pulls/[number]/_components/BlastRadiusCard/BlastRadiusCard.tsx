/* BlastRadiusCard — what else a PR can affect: touched symbols, their callers,
   and endpoints/crons that may depend on them (docs/plans/blast-radius.md).
   Read-only view over the persisted repo index; an unindexed repo is an
   expected state, not an error. Tree view only. */
"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { ErrorState, SectionLabel, Skeleton, Button } from "@devdigest/ui";
import { useBlastRadius, useReanalyzeBlast } from "@/lib/hooks/blast-radius";
import { INITIAL_VISIBLE_SYMBOLS } from "./constants";
import { bannerNotices, blockingNotice, defaultOpenKeys, shortSha, symbolKey } from "./helpers";
import { BlastStateNotice } from "./_components/BlastStateNotice/BlastStateNotice";
import { SummaryRow } from "./_components/SummaryRow/SummaryRow";
import { SymbolRow } from "./_components/SymbolRow/SymbolRow";
import { s } from "./styles";

interface BlastRadiusCardProps {
  prId: string | null;
  repoId: string;
}

function Shell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("blast");
  return (
    <section>
      <SectionLabel icon="GitBranch">{t("card.title")}</SectionLabel>
      <div style={s.card}>{children}</div>
    </section>
  );
}

export function BlastRadiusCard({ prId, repoId }: BlastRadiusCardProps) {
  const t = useTranslations("blast");
  const { data: report, isLoading, isError, refetch } = useBlastRadius(prId);
  const reanalyze = useReanalyzeBlast(repoId, prId);
  // userOpen overrides the derived default; no effect, no stored derived state.
  const [userOpen, setUserOpen] = useState<Record<string, boolean>>({});
  const [showAll, setShowAll] = useState(false);

  if (!prId) return null;

  if (isLoading) {
    return (
      <Shell>
        <div style={s.skeletonWrap} role="status" aria-label={t("card.loading")}>
          <Skeleton height={16} width="60%" />
          <Skeleton height={36} />
          <Skeleton height={36} />
        </div>
      </Shell>
    );
  }

  if (isError || !report) {
    return (
      <Shell>
        <ErrorState title={t("error.title")} body={t("error.body")} onRetry={() => refetch()} />
      </Shell>
    );
  }

  const noticeProps = { report, onReanalyze: reanalyze.mutate, reanalyzing: reanalyze.isPending };

  const blocking = blockingNotice(report);
  if (blocking) {
    return (
      <Shell>
        <BlastStateNotice notice={blocking} {...noticeProps} />
      </Shell>
    );
  }

  const defaults = defaultOpenKeys(report.symbols);
  const visible = showAll ? report.symbols : report.symbols.slice(0, INITIAL_VISIBLE_SYMBOLS);
  const hidden = report.symbols.length - visible.length;
  const incomplete = report.index.status === "partial" || !report.index.facts_complete;
  const sha = shortSha(report.index.last_indexed_sha);

  return (
    <Shell>
      {bannerNotices(report).map((key) => (
        <BlastStateNotice key={key} notice={key} {...noticeProps} />
      ))}
      <SummaryRow totals={report.totals} />
      <ul style={s.symbolList}>
        {visible.map((sym, i) => {
          const key = symbolKey(sym);
          return (
            <SymbolRow
              key={key}
              sym={sym}
              panelId={`blast-panel-${i}`}
              open={userOpen[key] ?? defaults.has(key)}
              incomplete={incomplete}
              onToggle={() => setUserOpen((prev) => ({ ...prev, [key]: !(prev[key] ?? defaults.has(key)) }))}
            />
          );
        })}
      </ul>
      <div style={s.moreRow}>
        {hidden > 0 && (
          <Button kind="ghost" size="sm" onClick={() => setShowAll(true)}>
            {t("card.showMoreSymbols", { count: hidden })}
          </Button>
        )}
        {report.totals.symbols > report.symbols.length && (
          <span style={s.plainNote}>
            {t("card.showingOf", { shown: report.symbols.length, total: report.totals.symbols })}
          </span>
        )}
      </div>
      <p style={s.footer}>
        {sha ? t("card.snapshotFootnote", { sha }) : t("card.snapshotFootnoteNoSha")}
      </p>
    </Shell>
  );
}
