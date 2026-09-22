/* ConventionsView — the Conventions Extractor's main view. See
   client/specs/conventions-extractor.md. "Selected" == "accepted": there is
   no separate multi-select layer, the accepted set IS what "Create skill"
   bundles (see that spec's note on the point). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { useConventions, useRunExtraction, useUpdateConvention } from "@/lib/hooks/conventions";
import { ConventionCard } from "./_components/ConventionCard";
import { CreateSkillFromConventionsModal } from "./_components/CreateSkillFromConventionsModal";
import { relativeTime } from "./helpers";
import { s } from "./styles";

export function ConventionsView({ repoId, repoName }: { repoId: string; repoName: string }) {
  const t = useTranslations("conventions");
  const [showCreateModal, setShowCreateModal] = React.useState(false);

  // Caller owns polling (mirrors useRepoIntelStatus): start false, flip on
  // once a fetched scan comes back "running", flip off once it's terminal.
  const [isPolling, setIsPolling] = React.useState(false);
  const { data, isLoading, isError, refetch } = useConventions(repoId, isPolling);
  const scan = data?.scan ?? null;

  React.useEffect(() => {
    setIsPolling(scan?.status === "running");
  }, [scan?.status]);

  const candidates = data?.candidates ?? [];

  const extract = useRunExtraction(repoId);
  const update = useUpdateConvention();

  const accepted = candidates.filter((c) => c.status === "accepted");

  const deselectAll = () => {
    for (const c of accepted) {
      update.mutate({ id: c.id, repoId, patch: { status: "pending" } });
    }
  };

  const setStatus = (c: ConventionCandidate, status: "accepted" | "rejected") => {
    update.mutate({ id: c.id, repoId, patch: { status: c.status === status ? "pending" : status } });
  };

  const editRule = (c: ConventionCandidate, rule: string) => {
    if (rule.trim() && rule !== c.rule) update.mutate({ id: c.id, repoId, patch: { rule: rule.trim() } });
  };

  const scanning = scan?.status === "running";

  return (
    <>
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.pageTitle}>{t("page.headingPrefix") + repoName}</h1>
          <p style={s.pageSubtitle}>{t("page.subtitle")}</p>
          {scan && (
            <p style={s.metaLine}>
              {t("page.detectedFrom", {
                count: scan.sample_file_count,
                when: relativeTime(scan.finished_at ?? scan.started_at),
              })}
            </p>
          )}
        </div>
        <div style={s.headerActions}>
          <Button
            kind="secondary"
            icon="RefreshCw"
            loading={scanning}
            disabled={scanning}
            onClick={() => extract.mutate()}
          >
            {scanning ? t("page.scanning") : t("page.rescan")}
          </Button>
        </div>
      </div>

      {candidates.length > 0 && (
        <div style={s.actionsBar}>
          <Button kind="tertiary" size="sm" onClick={deselectAll} disabled={accepted.length === 0}>
            {t("page.deselectAll")}
          </Button>
          <span style={s.acceptedCount}>
            {t("page.acceptedOf", { accepted: accepted.length, total: candidates.length })}
          </span>
          <div style={s.spacer} />
          <Button
            kind="primary"
            icon="Sparkles"
            disabled={accepted.length === 0}
            onClick={() => setShowCreateModal(true)}
          >
            {t("page.createSkill")}
          </Button>
        </div>
      )}

      {isLoading ? (
        <div style={s.list}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={120} />
          ))}
        </div>
      ) : isError ? (
        <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />
      ) : scan?.status === "failed" ? (
        <ErrorState title={t("page.extractionFailed")} body={scan.error ?? undefined} onRetry={() => extract.mutate()} />
      ) : candidates.length === 0 ? (
        <EmptyState
          icon="ListChecks"
          title={t("page.empty.title")}
          body={t("page.empty.body")}
          cta={scanning ? undefined : t("page.empty.cta")}
          onCta={scanning ? undefined : () => extract.mutate()}
          ctaLoading={scanning}
        />
      ) : (
        <div style={s.list}>
          {candidates.map((c) => (
            <ConventionCard
              key={c.id}
              candidate={c}
              onAccept={() => setStatus(c, "accepted")}
              onReject={() => setStatus(c, "rejected")}
              onEditRule={(rule) => editRule(c, rule)}
            />
          ))}
        </div>
      )}

      {showCreateModal && (
        <CreateSkillFromConventionsModal
          repoName={repoName}
          candidates={accepted}
          onClose={() => setShowCreateModal(false)}
        />
      )}
    </>
  );
}
