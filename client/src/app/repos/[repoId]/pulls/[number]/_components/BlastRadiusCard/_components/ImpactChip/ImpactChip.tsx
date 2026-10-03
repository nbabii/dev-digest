"use client";

import React from "react";
import { Icon } from "@devdigest/ui";
import { s } from "../../styles";

/** Endpoint (blue, globe) or cron (amber, clock) chip. The text carries the
    meaning; the icon is decorative. Badge has no `title`, so a plain span is used. */
export function ImpactChip({ kind, label }: { kind: "endpoint" | "cron"; label: string }) {
  const ChipIcon = kind === "endpoint" ? Icon.Globe : Icon.Clock;
  return (
    <span title={label} style={kind === "endpoint" ? s.chipEndpoint : s.chipCron}>
      <ChipIcon size={12} aria-hidden />
      <span style={s.chipText}>{label}</span>
    </span>
  );
}
