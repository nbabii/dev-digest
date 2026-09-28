import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import type { PrFile } from "@/lib/types";
import shellMessages from "../../../../messages/en/shell.json";
import { DiffViewer } from "./DiffViewer";

afterEach(cleanup);

const patch = "@@ -1,2 +1,3 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n+const c = 4;";
const file = (path: string): PrFile => ({ path, additions: 2, deletions: 1, patch }) as PrFile;

const finding = (id: string, path: string, line: number): FindingRecord =>
  ({
    id,
    severity: "CRITICAL",
    category: "bug",
    title: id,
    file: path,
    start_line: line,
    end_line: line,
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

const renderFinding = (f: FindingRecord) => <div data-testid={`finding-${f.id}`}>{`FND ${f.id}`}</div>;

function renderViewer(props: React.ComponentProps<typeof DiffViewer>) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: shellMessages }}>
      <DiffViewer {...props} />
    </NextIntlClientProvider>,
  );
}

const FILES = [
  file("pnpm-lock.yaml"),
  file("README.md"),
  file("src/index.ts"),
  file("src/a.test.ts"),
  file("src/config.ts"),
];

describe("DiffViewer smart order", () => {
  it("groups core->tests->wiring->docs->boilerplate, collapsing docs/boilerplate", () => {
    renderViewer({ files: FILES, order: "smart" });

    const sections = screen.getAllByRole("region");
    expect(sections.map((s) => s.getAttribute("aria-label"))).toEqual([
      "Core",
      "Tests",
      "Wiring",
      "Docs",
      "Boilerplate",
    ]);
    const toggle = (name: string) =>
      within(screen.getByRole("region", { name })).getByRole("button", { expanded: name === "Core" });
    expect(toggle("Core")).toHaveAttribute("aria-expanded", "true");
    for (const name of ["Docs", "Boilerplate"]) {
      const btn = within(screen.getByRole("region", { name })).getAllByRole("button")[0]!;
      expect(btn).toHaveAttribute("aria-expanded", "false");
    }
    expect(screen.queryByText("pnpm-lock.yaml")).not.toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("region", { name: "Boilerplate" })).getAllByRole("button")[0]!);
    expect(within(screen.getByRole("region", { name: "Boilerplate" })).getByText("pnpm-lock.yaml")).toBeInTheDocument();
  });

  it("omits empty groups", () => {
    renderViewer({ files: [file("src/config.ts")], order: "smart" });
    expect(screen.getAllByRole("region")).toHaveLength(1);
  });

  it("shows group findings count, file dot, inline finding and unanchored block", () => {
    renderViewer({
      files: [file("src/config.ts"), file("src/other.ts")],
      order: "smart",
      renderFinding,
      findings: [
        finding("on-line", "src/config.ts", 2),
        finding("off-line", "src/config.ts", 500),
        { ...finding("dismissed", "src/other.ts", 2), dismissed_at: "t" },
      ],
    });
    const core = screen.getByRole("region", { name: "Core" });
    // 1 file with findings (dismissed one excluded)
    expect(within(core).getByTitle("1 file with findings")).toHaveTextContent("1");
    expect(within(core).getByRole("img", { name: "2 findings in this file" })).toBeInTheDocument();
    expect(screen.queryByText("FND dismissed")).not.toBeInTheDocument();

    // anchored finding sits right after its line's row (line 2 = "const b = 3;")
    const lineRow = within(core).getAllByText("const b = 3;")[0]!.closest("div")!.parentElement!;
    expect(within(lineRow).getByTestId("finding-on-line")).toBeInTheDocument();
    expect(within(lineRow).queryByTestId("finding-off-line")).not.toBeInTheDocument();

    // unanchored block
    expect(screen.getByText("1 finding not on a changed line")).toBeInTheDocument();
    expect(screen.getByTestId("finding-off-line")).toBeInTheDocument();
  });
});

describe("DiffViewer findings arriving after mount", () => {
  const bigFile = { ...file("src/big.ts"), additions: 300, deletions: 0 } as PrFile;
  const files = [bigFile, file("README.md")];
  const ui = (findings?: FindingRecord[]) => (
    <NextIntlClientProvider locale="en" messages={{ shell: shellMessages }}>
      <DiffViewer files={files} order="smart" findings={findings} renderFinding={renderFinding} />
    </NextIntlClientProvider>
  );
  const docsToggle = () => within(screen.getByRole("region", { name: "Docs" })).getAllByRole("button")[0]!;

  it("auto-expands collapsed group and large file when findings show up later", () => {
    const { rerender } = render(ui());
    // large core file is collapsed (no lines), docs group collapsed
    expect(screen.queryByText("const b = 3;")).not.toBeInTheDocument();
    expect(docsToggle()).toHaveAttribute("aria-expanded", "false");

    rerender(ui([finding("big", "src/big.ts", 2), finding("doc", "README.md", 2)]));

    expect(docsToggle()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("finding-big")).toBeInTheDocument();
    expect(screen.getByTestId("finding-doc")).toBeInTheDocument();
  });

  it("keeps a manual collapse across rerenders with same or updated findings", () => {
    const first = [finding("big", "src/big.ts", 2), finding("doc", "README.md", 2)];
    const { rerender } = render(ui(first));
    expect(screen.getByTestId("finding-big")).toBeInTheDocument();

    // collapse the file card via its header, and the Docs group via its button
    fireEvent.click(screen.getByText("src/big.ts"));
    expect(screen.queryByTestId("finding-big")).not.toBeInTheDocument();
    fireEvent.click(docsToggle());
    expect(docsToggle()).toHaveAttribute("aria-expanded", "false");

    rerender(ui(first));
    rerender(ui([...first, finding("big2", "src/big.ts", 3)]));

    expect(screen.queryByTestId("finding-big")).not.toBeInTheDocument();
    expect(screen.queryByTestId("finding-big2")).not.toBeInTheDocument();
    expect(docsToggle()).toHaveAttribute("aria-expanded", "false");
  });
});

describe("DiffViewer original order", () => {
  it("renders a flat list in the given order without groups", () => {
    renderViewer({ files: FILES, order: "original" });
    expect(screen.queryAllByRole("region")).toHaveLength(0);
    const paths = screen.getAllByText(/\.(ts|md|yaml)$/).map((n) => n.textContent);
    expect(paths).toEqual(FILES.map((x) => x.path));
  });
});
