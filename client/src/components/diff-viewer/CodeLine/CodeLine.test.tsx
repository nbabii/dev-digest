import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import shellMessages from "../../../../messages/en/shell.json";
import { CodeLine } from "./CodeLine";

afterEach(cleanup);

const finding = (severity: string): FindingRecord =>
  ({
    id: "f1",
    severity,
    category: "bug",
    title: "t",
    file: "x.ts",
    start_line: 2,
    end_line: 2,
    rationale: "r",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  }) as FindingRecord;

function renderLine(severity: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: shellMessages }}>
      <CodeLine
        ln={{ kind: "add", text: "const b = 3;", newNo: 2 }}
        path="x.ts"
        threads={[]}
        findings={[finding(severity)]}
        renderFinding={(f) => <div>{`FND ${f.id}`}</div>}
      />
    </NextIntlClientProvider>,
  );
}

describe("CodeLine severity chip", () => {
  it("falls back to the raw lowercase text for an unknown severity without throwing", () => {
    renderLine("BLOCKER");
    expect(screen.getByText("blocker")).toBeInTheDocument();
    expect(screen.getByText("FND f1")).toBeInTheDocument();
    expect(screen.queryByText(/severityBLOCKER|diffViewer\./)).not.toBeInTheDocument();
  });

  it("still shows the translated label for a known severity", () => {
    renderLine("CRITICAL");
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.queryByText("critical")).not.toBeInTheDocument();
  });
});
