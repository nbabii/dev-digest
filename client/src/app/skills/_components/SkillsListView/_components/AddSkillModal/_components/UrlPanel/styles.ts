import type { CSSProperties } from "react";

/** Co-located styles for UrlPanel — same visual language as FilePanel's
    styles.ts, kept as a separate file rather than shared (see
    client/specs/skill-url-import.md's "not a shared abstraction" note). */
export const s = {
  body: { padding: 24 } satisfies CSSProperties,
  footer: {
    display: "flex",
    gap: 10,
    justifyContent: "flex-end",
    padding: "16px 24px",
    borderTop: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  stepsBar: { padding: "4px 0 22px" } satisfies CSSProperties,
  hint: { fontSize: 12, color: "var(--text-muted)", marginTop: 4 } satisfies CSSProperties,
  errorText: { fontSize: 13, color: "var(--crit)", marginTop: 10 } satisfies CSSProperties,
  section: { marginBottom: 18 } satisfies CSSProperties,
  sectionLabel: { fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 } satisfies CSSProperties,
  readonlyValue: { fontSize: 14, color: "var(--text-primary)" } satisfies CSSProperties,
  bodyPreview: {
    maxHeight: 220,
    overflow: "auto",
    padding: 12,
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--code-bg)",
  } satisfies CSSProperties,
  notice: {
    display: "flex",
    gap: 10,
    padding: 12,
    borderRadius: 7,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    color: "var(--text-secondary)",
    fontSize: 13,
    lineHeight: 1.5,
    marginBottom: 18,
  } satisfies CSSProperties,
  done: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    gap: 14,
    padding: "40px 24px",
  } satisfies CSSProperties,
} as const;
