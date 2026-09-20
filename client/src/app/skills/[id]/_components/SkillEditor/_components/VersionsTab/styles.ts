import type { CSSProperties } from "react";

/** Co-located styles for VersionsTab. */
export const s = {
  wrap: { maxWidth: 760 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700, marginBottom: 16 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    marginBottom: 8,
  } satisfies CSSProperties,
  version: { fontSize: 14, fontWeight: 700, width: 44, flexShrink: 0 } satisfies CSSProperties,
  timestamp: { fontSize: 13, color: "var(--text-secondary)", flex: 1 } satisfies CSSProperties,
  actions: { display: "flex", gap: 8 } satisfies CSSProperties,
  diffPane: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
    marginBottom: 14,
  } satisfies CSSProperties,
  diffCol: { minWidth: 0 } satisfies CSSProperties,
  diffLabel: { fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 } satisfies CSSProperties,
  diffPre: {
    margin: 0,
    padding: 12,
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--code-bg)",
    fontSize: 12,
    lineHeight: 1.55,
    maxHeight: 320,
    overflow: "auto",
    whiteSpace: "pre-wrap",
  } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
