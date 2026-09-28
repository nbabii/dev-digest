import type { CSSProperties } from "react";
import type { Line } from "./helpers";

/** Co-located styles for the DiffViewer (extracted from inline styles). */
export const s = {
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  empty: { padding: "24px", fontSize: 14, color: "var(--text-muted)", textAlign: "center" } satisfies CSSProperties,
  fileCard: {
    border: "1px solid var(--border)",
    borderRadius: 7,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  fileHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    cursor: "pointer",
  } satisfies CSSProperties,
  fileIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  filePath: {
    fontSize: 13,
    fontWeight: 500,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  fileStat: { fontSize: 12 } satisfies CSSProperties,
  addText: { color: "var(--code-add-text)" } satisfies CSSProperties,
  delText: { color: "var(--code-del-text)" } satisfies CSSProperties,
  fileBody: {
    borderTop: "1px solid var(--border)",
    padding: "8px 0",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  noDiff: {
    padding: "14px 18px",
    fontSize: 13,
    color: "var(--text-muted)",
    textAlign: "center",
  } satisfies CSSProperties,
  hunk: {
    fontSize: 12,
    lineHeight: "20px",
    color: "var(--accent-text)",
    background: "var(--accent-bg)",
    padding: "0 14px",
  } satisfies CSSProperties,
  lineNo: {
    width: 44,
    textAlign: "right",
    padding: "0 10px 0 0",
    color: "var(--text-muted)",
    userSelect: "none",
    flexShrink: 0,
  } satisfies CSSProperties,
  lineText: {
    flex: 1,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--text-primary)",
    paddingRight: 12,
  } satisfies CSSProperties,
} as const;

/** Chevron rotates 90deg when the file card is open. */
export function chevronFor(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  };
}

/** Row background per line kind (add/del tinted, others transparent). */
export function lineRowFor(kind: Line["kind"]): CSSProperties {
  const background = kind === "add" ? "var(--code-add)" : kind === "del" ? "var(--code-del)" : "transparent";
  return { display: "flex", alignItems: "stretch", fontSize: 13, lineHeight: "20px", background };
}

/** Gutter sign colour per line kind. */
export function lineSignFor(kind: Line["kind"]): CSSProperties {
  return {
    width: 14,
    textAlign: "center",
    color: kind === "add" ? "var(--code-add-text)" : kind === "del" ? "var(--code-del-text)" : "var(--text-muted)",
    flexShrink: 0,
  };
}

/** Smart Diff / inline-findings styles. */
export const fs = {
  dot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "var(--crit)",
    display: "inline-block",
    flexShrink: 0,
  } satisfies CSSProperties,
  findingWrap: { margin: "6px 14px 6px 58px" } satisfies CSSProperties,
  unanchoredWrap: {
    borderTop: "1px solid var(--border)",
    margin: "4px 14px 4px 14px",
    paddingTop: 10,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  unanchoredTitle: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  groups: { display: "flex", flexDirection: "column", gap: 18 } satisfies CSSProperties,
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "4px 2px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    color: "var(--text-primary)",
    font: "inherit",
  } satisfies CSSProperties,
  groupLabel: { fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  groupDesc: { fontSize: 12, color: "var(--text-muted)", flex: 1 } satisfies CSSProperties,
  groupMeta: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  groupFindings: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 12,
    color: "var(--crit)",
  } satisfies CSSProperties,
  groupFiles: { display: "flex", flexDirection: "column", gap: 10, marginTop: 8 } satisfies CSSProperties,
} as const;

export function roleSquare(color: string): CSSProperties {
  return { width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 };
}

/** Row style for a line with anchored findings: left severity bar. */
export function findingBar(color: string): CSSProperties {
  return { boxShadow: `inset 3px 0 0 ${color}` };
}

export function severityChip(color: string): CSSProperties {
  return {
    alignSelf: "center",
    flexShrink: 0,
    marginRight: 10,
    padding: "0 6px",
    borderRadius: 4,
    fontSize: 11,
    lineHeight: "16px",
    color,
    border: `1px solid ${color}`,
  };
}
