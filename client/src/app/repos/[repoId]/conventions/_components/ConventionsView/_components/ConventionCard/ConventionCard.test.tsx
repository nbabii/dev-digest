import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/conventions.json";
import { ConventionCard } from "./ConventionCard";

afterEach(cleanup);

const CANDIDATE: ConventionCandidate = {
  id: "c1",
  scan_id: "s1",
  repo_id: "r1",
  category: "naming",
  rule: "Always use async/await instead of .then() chains",
  evidence_path: "src/api/users.ts",
  evidence_line_start: 23,
  evidence_line_end: 31,
  evidence_snippet: "const user = await db.users.find(id);",
  confidence: 0.91,
  status: "pending",
  created_at: "2026-09-20T00:00:00.000Z",
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ConventionCard (smoke)", () => {
  it("renders the rule, evidence citation and snippet", () => {
    renderWithIntl(<ConventionCard candidate={CANDIDATE} onAccept={vi.fn()} onReject={vi.fn()} onEditRule={vi.fn()} />);
    expect(screen.getByText(CANDIDATE.rule)).toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts:23-31")).toBeInTheDocument();
    expect(screen.getByText(CANDIDATE.evidence_snippet)).toBeInTheDocument();
  });

  it("calls onAccept / onReject when their buttons are clicked", () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    renderWithIntl(<ConventionCard candidate={CANDIDATE} onAccept={onAccept} onReject={onReject} onEditRule={vi.fn()} />);
    fireEvent.click(screen.getByText("Accept as Skill"));
    expect(onAccept).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Reject"));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it("shows the terminal accepted/rejected labels once set", () => {
    renderWithIntl(
      <ConventionCard candidate={{ ...CANDIDATE, status: "accepted" }} onAccept={vi.fn()} onReject={vi.fn()} onEditRule={vi.fn()} />,
    );
    expect(screen.getByText("Accepted")).toBeInTheDocument();
  });

  it("commits an inline rule edit on blur", () => {
    const onEditRule = vi.fn();
    renderWithIntl(<ConventionCard candidate={CANDIDATE} onAccept={vi.fn()} onReject={vi.fn()} onEditRule={onEditRule} />);
    fireEvent.click(screen.getByText(CANDIDATE.rule));
    const input = screen.getByDisplayValue(CANDIDATE.rule);
    fireEvent.change(input, { target: { value: "Edited rule text" } });
    fireEvent.blur(input);
    expect(onEditRule).toHaveBeenCalledWith("Edited rule text");
  });
});
