/* DiffFinding — a FindingCard rendered inline under a diff line, wired to
   the accept/dismiss mutation (same as FindingsPanel). */
"use client";

import React from "react";
import type { FindingRecord } from "@devdigest/shared";
import { FindingCard } from "../../../FindingCard";
import { useFindingAction } from "@/lib/hooks/reviews";

export function DiffFinding({
  f,
  prId,
  repoFullName,
  headSha,
}: {
  f: FindingRecord;
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const action = useFindingAction();
  return (
    <FindingCard
      f={f}
      defaultExpanded
      pending={action.isPending}
      repoFullName={repoFullName}
      headSha={headSha}
      onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
    />
  );
}
