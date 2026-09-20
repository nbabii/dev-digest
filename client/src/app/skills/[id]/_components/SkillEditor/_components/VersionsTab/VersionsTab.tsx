"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillVersions, useUpdateSkill, type SkillVersion } from "../../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../../lib/toast";
import { formatVersionDate } from "./helpers";
import { s } from "./styles";

/** Versions tab — no existing Agents-versions-tab UI to copy (Agents ships
    Config only today); built directly against
    GET /skills/:id/versions[/:version]. */
export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const { data: versions, isLoading, isError, refetch } = useSkillVersions(skill.id);
  const update = useUpdateSkill();
  const [diffing, setDiffing] = React.useState<SkillVersion | null>(null);

  if (isLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={20} width={120} style={{ marginBottom: 16 }} />
        <Skeleton height={52} />
      </div>
    );
  }
  if (isError) {
    return <ErrorState body={t("versions.loadError")} onRetry={() => refetch()} />;
  }

  const restore = (v: SkillVersion) => {
    if (!window.confirm(t("versions.restoreConfirm", { version: v.version }))) return;
    update.mutate(
      { id: skill.id, patch: { body: v.body } },
      { onSuccess: (data) => toast.success(t("config.savedToast", { version: data.version })) },
    );
  };

  return (
    <div style={s.wrap}>
      <h2 style={s.h2}>{t("versions.title")}</h2>

      {diffing && (
        <div style={s.diffPane}>
          <div style={s.diffCol}>
            <div style={s.diffLabel}>{t("versions.diffTitle", { version: diffing.version })}</div>
            <pre className="mono" style={s.diffPre}>
              {diffing.body}
            </pre>
          </div>
          <div style={s.diffCol}>
            <div style={s.diffLabel}>{t("versions.current")}</div>
            <pre className="mono" style={s.diffPre}>
              {skill.body}
            </pre>
          </div>
        </div>
      )}

      {(versions ?? []).length === 0 ? (
        <div style={s.empty}>{t("versions.empty")}</div>
      ) : (
        (versions ?? []).map((v) => (
          <div key={v.version} style={s.row}>
            <span className="mono" style={s.version}>
              v{v.version}
            </span>
            <span style={s.timestamp}>{formatVersionDate(v.created_at)}</span>
            {v.version === skill.version && <Badge color="var(--ok)">{t("versions.current")}</Badge>}
            <div style={s.actions}>
              <Button
                kind="secondary"
                size="sm"
                icon="Code"
                onClick={() => setDiffing(diffing?.version === v.version ? null : v)}
              >
                {t("versions.diff")}
              </Button>
              <Button
                kind="secondary"
                size="sm"
                icon="History"
                disabled={update.isPending || v.version === skill.version}
                onClick={() => restore(v)}
              >
                {update.isPending ? t("versions.restoring") : t("versions.restore")}
              </Button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
