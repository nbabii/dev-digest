import type { CSSProperties } from "react";

export const s = {
  pageHeader: {
    padding: "24px 32px 10px",
    display: "flex",
    alignItems: "flex-start",
    gap: 16,
  } satisfies CSSProperties,
  pageTitle: {
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: "-0.02em",
  } satisfies CSSProperties,
  pageSubtitle: {
    fontSize: 14,
    color: "var(--text-secondary)",
    marginTop: 4,
  } satisfies CSSProperties,
  metaLine: {
    fontSize: 13,
    color: "var(--text-muted)",
    marginTop: 6,
  } satisfies CSSProperties,
  headerActions: {
    marginLeft: "auto",
    display: "flex",
    gap: 10,
    flexShrink: 0,
  } satisfies CSSProperties,
  actionsBar: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "0 32px 16px",
  } satisfies CSSProperties,
  acceptedCount: {
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    padding: "0 32px 32px",
  } satisfies CSSProperties,
};
