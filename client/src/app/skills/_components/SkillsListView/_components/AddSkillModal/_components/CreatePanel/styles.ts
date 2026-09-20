import type { CSSProperties } from "react";

/** Co-located styles for CreatePanel. */
export const s = {
  body: { padding: 24 } satisfies CSSProperties,
  footer: {
    padding: "16px 24px",
    borderTop: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
} as const;
