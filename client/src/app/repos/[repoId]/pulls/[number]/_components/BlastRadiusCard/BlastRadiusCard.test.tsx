import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadiusReport, BlastSymbolImpact } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/blast.json";

const hook = vi.hoisted(() => ({
  useBlastRadius: vi.fn(),
  reanalyze: vi.fn(),
}));

vi.mock("@/lib/hooks/blast-radius", () => ({
  useBlastRadius: hook.useBlastRadius,
  useReanalyzeBlast: () => ({ mutate: hook.reanalyze, isPending: false }),
}));

import { BlastRadiusCard } from "./BlastRadiusCard";

beforeEach(() => {
  hook.useBlastRadius.mockReset();
  hook.reanalyze.mockReset();
});
afterEach(cleanup);

function sym(over: Partial<BlastSymbolImpact> & { symbol: string }): BlastSymbolImpact {
  return {
    callers: [],
    endpoints_affected: [],
    crons_affected: [],
    file: "src/middleware/ratelimit.ts",
    kind: "function",
    line: 10,
    exported: true,
    match: "hunk",
    callers_total: 0,
    endpoints_total: 0,
    crons_total: 0,
    ...over,
  };
}

function report(over: Partial<BlastRadiusReport> = {}): BlastRadiusReport {
  return {
    repo: "acme/payments-api",
    pr_id: "pr1",
    pr_number: 482,
    index: {
      status: "ready",
      indexing: false,
      available: true,
      reason: null,
      facts_complete: true,
      last_indexed_sha: "abcdef1234567",
      indexed_at: "2026-10-01T00:00:00Z",
    },
    changed_files: {
      total: 2,
      covered: 2,
      uncovered: [],
      no_symbol_touched: [],
      without_patch: 0,
      source: "pr_files",
      truncated: false,
    },
    totals: { symbols: 1, callers: 1, endpoints: 1, crons: 1 },
    symbols: [
      sym({
        symbol: "rateLimit",
        callers: [{ name: "handler", file: "src/api/public/index.ts", line: 23, url: "https://github.com/acme/payments-api/blob/abcdef1234567/src/api/public/index.ts#L23" }],
        callers_total: 1,
        endpoints_affected: ["GET /api/public/items"],
        endpoints_total: 1,
        crons_affected: ["reset-buckets (hourly)"],
        crons_total: 1,
      }),
    ],
    limits: { symbols_truncated: false, callers_truncated: false },
    ...over,
  };
}

function withIndex(over: Partial<BlastRadiusReport["index"]>, rest: Partial<BlastRadiusReport> = {}) {
  const base = report();
  return report({ index: { ...base.index, ...over }, ...rest });
}

function renderCard() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
      <BlastRadiusCard prId="pr1" repoId="r1" />
    </NextIntlClientProvider>,
  );
}

function mockData(data: BlastRadiusReport | undefined, extra: Record<string, unknown> = {}) {
  hook.useBlastRadius.mockReturnValue({ data, isLoading: false, isError: false, refetch: vi.fn(), ...extra });
}

describe("BlastRadiusCard", () => {
  it("shows skeleton, then totals (not recomputed), collapsible rows, links and chips", () => {
    hook.useBlastRadius.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    const { unmount } = renderCard();
    expect(screen.getByRole("status", { name: "Loading blast radius" })).toBeInTheDocument();
    unmount();

    // Inconsistent on purpose: totals say 14 callers / 40 symbols while the arrays are capped.
    const many = Array.from({ length: 12 }, (_, i) =>
      sym({
        symbol: `fn${i}`,
        line: i + 1,
        callers_total: i === 0 ? 5 : 0,
        callers:
          i === 0
            ? [{ name: "a", file: "src/a.ts", line: 3, url: "https://github.com/acme/payments-api/blob/abc/src/a.ts#L3" }]
            : [],
        endpoints_affected: i === 0 ? ["GET /api/public/items"] : [],
        endpoints_total: i === 0 ? 3 : 0,
        crons_affected: i === 0 ? ["reset-buckets (hourly)"] : [],
        crons_total: i === 0 ? 1 : 0,
      }),
    );
    mockData(report({ symbols: many, totals: { symbols: 40, callers: 14, endpoints: 7, crons: 2 }, limits: { symbols_truncated: true, callers_truncated: false } }));
    renderCard();

    const stats = screen.getAllByRole("listitem").slice(0, 4);
    expect(within(stats[0]!).getByText("40")).toBeInTheDocument();
    expect(within(stats[1]!).getByText("14")).toBeInTheDocument();
    expect(within(stats[2]!).getByText("7")).toBeInTheDocument();
    expect(within(stats[3]!).getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Showing 12 of 40 symbols")).toBeInTheDocument();
    expect(screen.getByText("Based on the default-branch index at abcdef1; code added in this PR is not included.")).toBeInTheDocument();

    // First symbol with callers starts open: link, capped markers, chips.
    const link = screen.getByRole("link", { name: "Open src/a.ts line 3 on GitHub, new tab" });
    expect(link).toHaveAttribute("href", "https://github.com/acme/payments-api/blob/abc/src/a.ts#L3");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByText("+4 more callers")).toBeInTheDocument();
    expect(screen.getByText("GET /api/public/items")).toBeInTheDocument();
    expect(screen.getByText("+2 more")).toBeInTheDocument();
    expect(screen.getByText("reset-buckets (hourly)")).toBeInTheDocument();

    // Toggle collapses and re-expands.
    const toggle = screen.getByRole("button", { name: /fn0\(\)/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: /src\/a\.ts/ })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByRole("link", { name: /src\/a\.ts/ })).toBeInTheDocument();

    // 10 initially visible, then the rest.
    expect(screen.queryByText("fn11()")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more symbols" }));
    expect(screen.getByText("fn11()")).toBeInTheDocument();
  });

  it.each([
    ["not_indexed", withIndex({ status: "not_indexed", available: false }, { symbols: [] }), "This repo is not indexed yet", true],
    ["degraded", withIndex({ status: "degraded", available: false, reason: "graph_failed" }, { symbols: [] }), "The index is unavailable", true],
    ["disabled", withIndex({ status: "disabled", available: false }, { symbols: [] }), "Repo analysis is turned off", false],
    ["no changed files", report({ symbols: [], changed_files: { ...report().changed_files, total: 0, covered: 0 } }), "No changed files found", false],
    ["no symbols", report({ symbols: [], totals: { symbols: 0, callers: 0, endpoints: 0, crons: 0 } }), "No indexed symbols in the changed files", false],
  ])("shows the %s state", (_name, data, title, canReanalyze) => {
    mockData(data);
    renderCard();
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /Callers of/ })).not.toBeInTheDocument();
    const btn = screen.queryByRole("button", { name: "Re-analyze" });
    if (canReanalyze) {
      fireEvent.click(btn!);
      expect(hook.reanalyze).toHaveBeenCalledTimes(1);
    } else {
      expect(btn).not.toBeInTheDocument();
    }
  });

  it("announces indexing as a status without a Re-analyze button", () => {
    mockData(withIndex({ status: "not_indexed", available: false, indexing: true }, { symbols: [] }));
    renderCard();
    expect(screen.getByRole("status")).toHaveTextContent("Indexing in progress");
    expect(screen.queryByRole("button", { name: "Re-analyze" })).not.toBeInTheDocument();
  });

  it("lists files when the diff touches no declared symbol", () => {
    mockData(
      report({
        symbols: [],
        totals: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
        changed_files: { ...report().changed_files, no_symbol_touched: ["src/config.ts", "src/types.ts"] },
      }),
    );
    renderCard();
    expect(screen.getByText("The diff touches no declared symbol")).toBeInTheDocument();
    expect(screen.getByText(/imports or top-level code in 2 files/)).toBeInTheDocument();
    expect(screen.getByText("src/config.ts")).toBeInTheDocument();
  });

  it("collapses a long file list behind a toggle", () => {
    const files = Array.from({ length: 12 }, (_, i) => `src/file-${i}.ts`);
    mockData(
      report({
        symbols: [],
        totals: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
        changed_files: { ...report().changed_files, no_symbol_touched: files },
      }),
    );
    renderCard();
    expect(screen.getByText("src/file-4.ts")).toBeInTheDocument();
    expect(screen.queryByText("src/file-5.ts")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show 7 more files" }));
    expect(screen.getByText("src/file-11.ts")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(screen.queryByText("src/file-11.ts")).not.toBeInTheDocument();
  });

  it("shows banner and data for a partial index, and never says no callers when incomplete", () => {
    mockData(
      withIndex(
        { status: "partial", reason: "soft_budget", facts_complete: false },
        {
          totals: { symbols: 1, callers: 0, endpoints: 0, crons: 0 },
          symbols: [sym({ symbol: "rateLimit", file: "src/a.ts" })],
          changed_files: { ...report().changed_files, uncovered: ["src/new.ts"], covered: 1 },
        },
      ),
    );
    renderCard();
    expect(screen.getByText("Callers unknown")).toBeInTheDocument();
    expect(screen.getByText("rateLimit()")).toBeInTheDocument();
    expect(screen.queryByText("No callers found")).not.toBeInTheDocument();
    expect(screen.getByText("Not covered by the index")).toBeInTheDocument();
    expect(screen.getByText("src/new.ts")).toBeInTheDocument();
  });

  it("says no callers for a complete index and tags match:'file' symbols", () => {
    mockData(
      report({
        totals: { symbols: 1, callers: 0, endpoints: 0, crons: 0 },
        symbols: [sym({ symbol: "bucketKey", match: "file" })],
      }),
    );
    renderCard();
    expect(screen.getByText("No callers found")).toBeInTheDocument();
    const tag = screen.getByText("whole file");
    expect(tag).toHaveAttribute("title", expect.stringContaining("no diff available"));
    fireEvent.click(screen.getByRole("button", { name: /bucketKey\(\)/ }));
    expect(screen.getByText("No direct callers found.")).toBeInTheDocument();
  });

  it("shows a re-indexing status banner together with data", () => {
    mockData(withIndex({ indexing: true }));
    renderCard();
    expect(screen.getByRole("status")).toHaveTextContent("Re-indexing");
    expect(screen.getByText("rateLimit()")).toBeInTheDocument();
  });

  it("shows an error with retry that calls refetch", () => {
    const refetch = vi.fn();
    mockData(undefined, { isError: true, refetch });
    renderCard();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load the blast radius");
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
