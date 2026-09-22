/* Route: /skills. Once the list loads, redirect straight to the first
   skill's two-pane editor rather than stopping at a bare grid — clicking
   "Skills" in the nav should open a skill, not an empty selector (matches
   the design: Skills Lab > Skills always shows list + a skill's details).
   Falls back to SkillsListView's own grid + empty state only when the
   workspace genuinely has zero skills — there's nothing to redirect to. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Skeleton } from "@devdigest/ui";
import { AppShell } from "../../components/app-shell";
import { useSkills } from "../../lib/hooks/skills";
import { SkillsListView } from "./_components/SkillsListView";

export default function SkillsPage() {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: skills, isLoading } = useSkills();

  const firstId = skills?.[0]?.id ?? null;

  React.useEffect(() => {
    if (firstId) router.replace(`/skills/${firstId}?tab=config`);
  }, [firstId, router]);

  // Loading, or a redirect is about to fire — skip the grid to avoid a
  // flash of the list-only view right before bouncing to /skills/:id.
  if (isLoading || firstId) {
    return (
      <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }]}>
        <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 16 }}>
          <Skeleton height={24} width={240} />
          <Skeleton height={400} />
        </div>
      </AppShell>
    );
  }

  return <SkillsListView />;
}
