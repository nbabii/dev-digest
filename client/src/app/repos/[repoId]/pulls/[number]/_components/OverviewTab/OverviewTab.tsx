"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "../IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null;
  repoId: string;
}

export function OverviewTab({ prBody, prId, repoId }: OverviewTabProps) {
  return (
    <>
      <div style={s.grid}>
        <IntentCard prId={prId} />
        <BlastRadiusCard prId={prId} repoId={repoId} />
      </div>

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
