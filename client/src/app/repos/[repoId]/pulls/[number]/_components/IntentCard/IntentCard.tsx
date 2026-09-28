/* IntentCard — the classified Intent (summary, scope, confidence, sources)
   for a PR, shown at the top of OverviewTab (Architecture decision 9,
   docs/plans/intent-layer.md). A GET failure (e.g. no provider key
   configured yet) is an expected, non-fatal state — it must degrade to an
   inline retry, never crash the page. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import type { IconName } from "@devdigest/ui";
import { useIntent, useReclassifyIntent } from "../../../../../../../lib/hooks/intent";
import { sourcesCaption } from "./helpers";
import { s } from "./styles";

function ScopeList({ title, icon, items }: { title: string; icon: IconName; items: string[] }) {
  const ItemIcon = Icon[icon];
  return (
    <div style={s.scopeColumn}>
      <span style={s.scopeTitle}>{title}</span>
      {items.map((item, i) => (
        <div key={i} style={s.scopeItem}>
          <ItemIcon size={14} style={s.scopeItemIcon} />
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

function IntentCardShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("intent");
  return (
    <section>
      <SectionLabel icon="Target">{t("card.title")}</SectionLabel>
      <div style={s.card}>{children}</div>
    </section>
  );
}

export function IntentCard({ prId }: { prId: string | null }) {
  const t = useTranslations("intent");
  const { data: intent, isLoading, isError } = useIntent(prId);
  const reclassify = useReclassifyIntent(prId);

  if (!prId) return null;

  if (isLoading) {
    return (
      <IntentCardShell>
        <div style={s.skeletonWrap}>
          <Skeleton height={16} width="70%" />
          <Skeleton height={14} width="40%" />
          <Skeleton height={60} />
        </div>
      </IntentCardShell>
    );
  }

  if (isError || !intent) {
    return (
      <IntentCardShell>
        {/* Retry re-runs the classifier via the reclassify mutation, not a plain
            GET refetch — a first-attempt GET failure (e.g. no provider key
            configured) would otherwise just fail identically on refetch. */}
        <ErrorState title={t("error.title")} body={t("error.body")} onRetry={() => reclassify.mutate()} />
      </IntentCardShell>
    );
  }

  return (
    <IntentCardShell>
      <div style={s.headerRow}>
        <p style={s.summary}>{intent.summary}</p>
        <Button
          kind="ghost"
          icon="RefreshCw"
          size="sm"
          loading={reclassify.isPending}
          onClick={() => reclassify.mutate()}
        >
          {reclassify.isPending ? t("card.reclassifying") : t("card.reclassify")}
        </Button>
      </div>

      <div style={s.badgesRow}>
        <Badge icon="Gauge">
          {t("card.confidence")}: {Math.round(intent.confidence * 100)}%
        </Badge>
        {intent.insufficient_context && (
          <Badge icon="AlertTriangle" color="var(--warn)" bg="var(--warn-bg)">
            {t("card.insufficientContext")}
          </Badge>
        )}
      </div>

      {intent.insufficient_context && <p style={s.note}>{t("card.insufficientContextNote")}</p>}

      <div style={s.scopeGrid}>
        <ScopeList title={t("card.inScope")} icon="Check" items={intent.in_scope} />
        <ScopeList title={t("card.outOfScope")} icon="X" items={intent.out_of_scope} />
      </div>

      {intent.sources.length > 0 && (
        <p style={s.sourcesCaption}>{t("card.sourcesCaption", { sources: sourcesCaption(intent.sources) })}</p>
      )}
    </IntentCardShell>
  );
}
