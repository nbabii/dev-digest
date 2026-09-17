"use client";

/* FindingsPopover — severity-count badge group that, on hover, opens a panel
   listing the underlying findings (icon + title + category + file:line +
   confidence + a short rationale preview). Shared between the PR list's
   Findings column and the PR detail page's Agent runs timeline; see
   client/specs/findings-counter.md. */

import React from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { SeverityBadge, CategoryTag, MonoLink, ConfidenceNum, type Severity, type Category } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import {
  SEVERITY_ORDER,
  lineLabel,
  openFindings,
  rationalePreview,
  sortFindings,
  type SeverityCounts,
} from "./helpers";

const CLOSE_DELAY_MS = 120;

export function FindingsPopover({
  counts,
  findings,
  loadingFindings,
  scope,
  repoFullName,
  headSha,
  onOpenChange,
}: {
  /** Eager per-severity counts — always known up front (list column or run row). */
  counts: SeverityCounts;
  /** Full finding records for the panel; undefined while a lazy fetch is pending. */
  findings: FindingRecord[] | undefined;
  loadingFindings?: boolean;
  scope: "pr" | "run";
  repoFullName?: string | null;
  headSha?: string | null;
  /** Fires when the panel opens/closes — lets a caller lazy-fetch `findings` on first open. */
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations("prReview");
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const triggerRef = React.useRef<HTMLDivElement>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  const clearCloseTimer = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  // The panel is portaled to <body> (fixed position) so it can't be clipped
  // by an `overflow: hidden` ancestor — the PR list's table card auto-sizes
  // to its rows, so an in-flow absolutely-positioned panel gets cut off
  // almost immediately. See client/specs/findings-counter.md.
  const PANEL_MAX_HEIGHT = 480;
  const VIEWPORT_MARGIN = 12;

  const handleEnter = () => {
    clearCloseTimer();
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const top = rect.bottom + 6;
      // Only cap height to whatever room is actually left below the trigger —
      // a short finding list should never scroll just because of a fixed cap.
      const maxHeight = Math.min(PANEL_MAX_HEIGHT, window.innerHeight - top - VIEWPORT_MARGIN);
      setPos({ top, left: rect.left, maxHeight });
    }
    setOpen(true);
  };
  const handleLeave = () => {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };
  React.useEffect(() => clearCloseTimer, []);

  const total = counts.CRITICAL + counts.WARNING + counts.SUGGESTION;
  const shown = SEVERITY_ORDER.filter((sev) => counts[sev] > 0);
  const sorted = findings ? sortFindings(openFindings(findings)) : [];

  if (total === 0) {
    return <span style={{ color: "var(--text-muted)" }}>—</span>;
  }

  return (
    <div
      ref={triggerRef}
      style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {shown.map((sev) => (
        <SeverityBadge key={sev} severity={sev as Severity} count={counts[sev]} compact />
      ))}

      {open &&
        pos &&
        createPortal(
          <div
            onMouseEnter={handleEnter}
            onMouseLeave={handleLeave}
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: 360,
              maxHeight: pos.maxHeight,
              display: "flex",
              flexDirection: "column",
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-strong)",
              borderRadius: 9,
              boxShadow: "var(--shadow-modal)",
              overflow: "hidden",
              zIndex: 100,
            }}
          >
            <div
              style={{
                padding: "10px 14px",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
                borderBottom: "1px solid var(--border)",
                flexShrink: 0,
              }}
            >
              {scope === "run"
                ? t("findingsPopover.titleRun", { count: total })
                : t("findingsPopover.titleAll", { count: total })}
            </div>
            <div
              style={{
                overflowY: "auto",
                overflowX: "hidden",
                padding: 8,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {loadingFindings ? (
                <div style={{ padding: "10px 6px", fontSize: 12.5, color: "var(--text-muted)" }}>
                  {t("findingsPopover.loading")}
                </div>
              ) : sorted.length === 0 ? (
                <div style={{ padding: "10px 6px", fontSize: 12.5, color: "var(--text-muted)" }}>
                  {t("findingsPopover.empty")}
                </div>
              ) : (
                sorted.map((f) => <FindingRow key={f.id} f={f} repoFullName={repoFullName} headSha={headSha} />)
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function FindingRow({
  f,
  repoFullName,
  headSha,
}: {
  f: FindingRecord;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const fileHref =
    repoFullName && headSha ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line) : undefined;
  return (
    <div
      style={{
        padding: "8px 8px",
        borderRadius: 6,
        display: "flex",
        flexDirection: "column",
        gap: 5,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <SeverityBadge severity={f.severity as Severity} compact />
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", flex: 1, minWidth: 0 }}>
          {f.title}
        </span>
        <CategoryTag category={f.category as Category} />
      </div>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", rowGap: 2, columnGap: 10, fontSize: 12 }}>
        <MonoLink href={fileHref}>
          {f.file}:{lineLabel(f)}
        </MonoLink>
        <ConfidenceNum value={f.confidence} />
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{rationalePreview(f.rationale)}</div>
    </div>
  );
}
