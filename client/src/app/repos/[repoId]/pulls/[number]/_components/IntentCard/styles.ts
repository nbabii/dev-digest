import type { CSSProperties } from "react";

export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } satisfies CSSProperties,
  headerRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  } satisfies CSSProperties,
  summary: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.55,
    color: "var(--text-primary)",
    flex: 1,
  } satisfies CSSProperties,
  badgesRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  note: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  scopeGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 20,
  } satisfies CSSProperties,
  scopeColumn: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  scopeTitle: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  scopeItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    fontSize: 13.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  scopeItemIcon: {
    marginTop: 2,
    flexShrink: 0,
  } satisfies CSSProperties,
  sourcesCaption: {
    margin: 0,
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  skeletonWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
} as const;
