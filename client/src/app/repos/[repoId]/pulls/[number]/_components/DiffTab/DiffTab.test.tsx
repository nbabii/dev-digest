import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile } from "@devdigest/shared";
import shellMessages from "../../../../../../../../messages/en/shell.json";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";

const mutate = vi.fn();
const commentsState = vi.hoisted(() => ({ data: [] as unknown[] }));
vi.mock("@/lib/hooks/reviews", () => ({
  usePrComments: () => ({ data: commentsState.data }),
  useCreatePrComment: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useFindingAction: () => ({ mutate, isPending: false }),
}));

import { DiffTab } from "./DiffTab";

const patch = "@@ -1,2 +1,3 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n+const c = 4;";
const FILES = [
  { path: "README.md", additions: 2, deletions: 1, patch },
  { path: "src/config.ts", additions: 2, deletions: 1, patch },
] as PrFile[];

const FINDING = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded secret",
  file: "src/config.ts",
  start_line: 2,
  end_line: 2,
  rationale: "A secret is committed.",
  suggestion: null,
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
} as FindingRecord;

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: shellMessages, prReview: prReviewMessages }}>
      <DiffTab prId="pr1" filesCount={2} files={FILES} findings={[FINDING]} repoFullName="o/r" headSha="abc" />
    </NextIntlClientProvider>,
  );
}

const radio = (name: string) => screen.getByRole("radio", { name });
const regionNames = () => screen.queryAllByRole("region").map((r) => r.getAttribute("aria-label"));

beforeEach(() => {
  window.localStorage.clear();
  mutate.mockClear();
  commentsState.data = [];
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DiffTab", () => {
  it("defaults to smart order, switches to original and persists the choice", () => {
    renderTab();
    expect(screen.getByRole("radiogroup", { name: "File order" })).toBeInTheDocument();
    expect(radio("Smart order")).toHaveAttribute("aria-checked", "true");
    expect(regionNames()).toEqual(["Core", "Docs"]);

    fireEvent.click(radio("Original order"));
    expect(radio("Original order")).toHaveAttribute("aria-checked", "true");
    expect(regionNames()).toEqual([]);
    expect(window.localStorage.getItem("dd-diff-order")).toBe("original");

    // a remount restores the stored preference
    cleanup();
    renderTab();
    expect(radio("Original order")).toHaveAttribute("aria-checked", "true");
  });

  it("does not crash when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    renderTab();
    expect(radio("Smart order")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(radio("Original order"));
    expect(radio("Original order")).toHaveAttribute("aria-checked", "true");
  });

  it("header totals sum additions and deletions over all files", () => {
    renderTab();
    expect(screen.getByTestId("diff-total-additions")).toHaveTextContent("+4");
    expect(screen.getByTestId("diff-total-deletions").textContent).toBe("\u22122");
  });

  it("Accept on the inline finding calls the finding action", () => {
    renderTab();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("region", { name: "Core" })).getByRole("button", { name: "Accept" }));
    expect(mutate).toHaveBeenCalledWith({ findingId: "f1", action: "accept", prId: "pr1" });
  });

  it("keeps the order toggle last in the header's right slot when the comments button is present", () => {
    commentsState.data = [
      { id: 1, path: "src/config.ts", line: 2, side: "RIGHT", body: "hi", author: "a", created_at: "2026-01-01T00:00:00Z" },
    ];
    renderTab();
    const commentsBtn = screen.getByRole("button", { name: /show comments/i });
    const group = screen.getByRole("radiogroup", { name: "File order" });
    expect(commentsBtn.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(commentsBtn.parentElement).toBe(group.parentElement);
    expect(group.parentElement!.lastElementChild).toBe(group);
  });
});
