import type { CSSProperties } from "react";

export const s = {
  body: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    padding: 20,
  } satisfies CSSProperties,
  banner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 8,
    background: "var(--accent-bg)",
    color: "var(--accent-text)",
    fontSize: 13,
  } satisfies CSSProperties,
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
  } satisfies CSSProperties,
};
