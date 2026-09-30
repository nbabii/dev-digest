"use client";

import React from "react";
import type { DiffOrder } from "@/components/diff-viewer";

export const DIFF_ORDER_KEY = "dd-diff-order";

/** Smart/original file-order preference, persisted in localStorage. Defaults to
    smart; read in an effect (not during render) to avoid an SSR hydration
    mismatch. Storage access is try/catch-guarded (private mode, disabled storage). */
export function useSmartOrder(): [DiffOrder, (next: DiffOrder) => void] {
  const [order, setOrder] = React.useState<DiffOrder>("smart");

  React.useEffect(() => {
    try {
      const v = window.localStorage.getItem(DIFF_ORDER_KEY);
      if (v === "smart" || v === "original") setOrder(v);
    } catch {
      /* storage unavailable — keep default */
    }
  }, []);

  const update = React.useCallback((next: DiffOrder) => {
    setOrder(next);
    try {
      window.localStorage.setItem(DIFF_ORDER_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  return [order, update];
}
