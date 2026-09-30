/* SegmentedToggle — small two-option radiogroup (no such control in @devdigest/ui). */
"use client";

import React from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export function SegmentedToggle<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      style={{
        display: "inline-flex",
        border: "1px solid var(--border)",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            style={{
              padding: "3px 10px",
              fontSize: 12,
              border: "none",
              cursor: "pointer",
              color: active ? "var(--text-primary)" : "var(--text-muted)",
              background: active ? "var(--bg-elevated)" : "transparent",
              fontWeight: active ? 600 : 400,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
