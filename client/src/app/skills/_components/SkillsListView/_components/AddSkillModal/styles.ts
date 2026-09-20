import type { CSSProperties } from "react";

/** Co-located styles for AddSkillModal's tab bar (Create / From file /
    Import from URL) — a segmented control, not the underline-style `Tabs`
    primitive used elsewhere (that one doesn't match this design). */
export const s = {
  tabBar: {
    display: "flex",
    gap: 6,
    padding: "14px 24px 16px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  tabBtn: (active: boolean): CSSProperties => ({
    padding: "7px 14px",
    borderRadius: 7,
    border: "none",
    cursor: "pointer",
    fontSize: 13.5,
    fontWeight: 600,
    background: active ? "var(--accent)" : "transparent",
    color: active ? "#fff" : "var(--text-secondary)",
  }),
} as const;
