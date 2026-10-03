"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { IconName } from "@devdigest/ui";
import type { BlastRadiusReport } from "@devdigest/shared";
import { s } from "../../styles";

type Totals = BlastRadiusReport["totals"];

const STATS: { key: keyof Totals; icon: IconName }[] = [
  { key: "symbols", icon: "GitBranch" },
  { key: "callers", icon: "CornerDownRight" },
  { key: "endpoints", icon: "Globe" },
  { key: "crons", icon: "Clock" },
];

/** Reads server-computed totals only; never sums the capped arrays. */
export function SummaryRow({ totals }: { totals: Totals }) {
  const t = useTranslations("blast");
  return (
    <ul style={s.summaryRow}>
      {STATS.map(({ key, icon }) => {
        const StatIcon = Icon[icon];
        return (
          <li key={key} style={s.stat}>
            <StatIcon size={14} aria-hidden style={s.muted} />
            <span style={s.statNumber}>{totals[key]}</span>
            <span>{t(`stat.${key}`, { count: totals[key] })}</span>
          </li>
        );
      })}
    </ul>
  );
}
