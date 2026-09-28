/* CodeLine — one rendered diff line: gutter number, +/- sign, text, plus the
   hover "+" affordance, any anchored comment threads, and an inline composer. */
"use client";

import React from "react";
import { commentTargetFor, type CommentThread, type DiffCommentApi, cs } from "../comments";
import { type Line } from "../helpers";
import { useTranslations } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import { s, fs, lineRowFor, lineSignFor, findingBar, severityChip } from "../styles";
import { SEVERITY_COLOR, SEVERITY_COLOR_FALLBACK } from "../constants";
import { CommentThreadView } from "../CommentThreadView";
import { InlineComposer } from "../InlineComposer";

const KNOWN_SEVERITIES = new Set(Object.keys(SEVERITY_COLOR));

/** Translate known severities; fall back to the raw lowercase value for unknown ones. */
function severityLabel(t: (key: string) => string, severity: string): string {
  return KNOWN_SEVERITIES.has(severity)
    ? t(`diffViewer.severity${severity}`)
    : severity.toLowerCase();
}

export function CodeLine({
  ln,
  path,
  threads,
  commenting,
  findings = [],
  renderFinding,
}: {
  ln: Line;
  path: string;
  threads: CommentThread[];
  commenting?: DiffCommentApi;
  /** Findings anchored to this line (RIGHT side). */
  findings?: FindingRecord[];
  renderFinding?: (f: FindingRecord) => React.ReactNode;
}) {
  const t = useTranslations("shell");
  const [hover, setHover] = React.useState(false);
  const [composing, setComposing] = React.useState(false);

  if (ln.kind === "hunk") {
    return (
      <div className="mono" style={s.hunk}>
        {ln.text}
      </div>
    );
  }

  const sign = ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : "";
  const target = commenting?.canComment ? commentTargetFor(ln) : null;
  const showAdd = hover && !!target && !composing;
  const shownFindings = renderFinding ? findings : [];
  const top = shownFindings[0];
  const topColor = top ? (SEVERITY_COLOR[top.severity] ?? SEVERITY_COLOR_FALLBACK) : undefined;

  return (
    <div
      style={cs.rowWrap}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={topColor ? { ...lineRowFor(ln.kind), ...findingBar(topColor) } : lineRowFor(ln.kind)}>
        <span className="mono tnum" style={{ ...s.lineNo, position: "relative" }}>
          {showAdd && target && (
            <button
              type="button"
              title="Add a comment on this line"
              aria-label="Add a comment on this line"
              onClick={() => setComposing(true)}
              style={cs.addBtn}
            >
              +
            </button>
          )}
          {ln.newNo ?? ln.oldNo ?? ""}
        </span>
        <span className="mono" style={lineSignFor(ln.kind)}>
          {sign}
        </span>
        <span className="mono" style={s.lineText}>
          {ln.text || " "}
        </span>
        {top && topColor && (
          <span style={severityChip(topColor)}>{severityLabel(t, top.severity)}</span>
        )}
      </div>

      {renderFinding &&
        shownFindings.map((f) => (
          <div key={f.id} style={fs.findingWrap}>
            {renderFinding(f)}
          </div>
        ))}

      {commenting &&
        commenting.showComments &&
        threads.map((th) => (
          <CommentThreadView key={th.rootId} thread={th} commenting={commenting} path={path} />
        ))}

      {commenting && composing && target && (
        <InlineComposer
          commenting={commenting}
          path={path}
          line={target.line}
          side={target.side}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}
