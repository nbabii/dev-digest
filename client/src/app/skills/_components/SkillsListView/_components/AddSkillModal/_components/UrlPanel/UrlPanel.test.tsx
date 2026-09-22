import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../../messages/en/skills.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const previewMutateAsync = vi.fn();
const confirmMutateAsync = vi.fn();

vi.mock("../../../../../../../../lib/hooks/skills", () => ({
  useImportUrlPreview: () => ({ mutateAsync: previewMutateAsync, isPending: false, isError: false, error: null }),
  useConfirmSkillImport: () => ({ mutateAsync: confirmMutateAsync, isPending: false, isError: false, error: null }),
}));

import { UrlPanel } from "./UrlPanel";

afterEach(() => {
  cleanup();
  previewMutateAsync.mockReset();
  confirmMutateAsync.mockReset();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={{ skills: messages }}>{ui}</NextIntlClientProvider>);
}

describe("UrlPanel (smoke)", () => {
  it("disables Continue until the URL looks like a valid https:// address", () => {
    renderWithIntl(<UrlPanel onClose={vi.fn()} />);
    const continueBtn = screen.getByText("Continue").closest("button")!;
    expect(continueBtn).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("https://example.com/skills/security.md"), {
      target: { value: "not a url" },
    });
    expect(continueBtn).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("https://example.com/skills/security.md"), {
      target: { value: "http://example.com/skill.md" },
    });
    expect(continueBtn).toBeDisabled(); // http, not https

    fireEvent.change(screen.getByPlaceholderText("https://example.com/skills/security.md"), {
      target: { value: "https://raw.githubusercontent.com/org/repo/main/skill.md" },
    });
    expect(continueBtn).not.toBeDisabled();
  });

  it("fetches a preview, then shows it read-only, then confirms and creates the skill", async () => {
    previewMutateAsync.mockResolvedValue({
      name: "my-skill",
      description: "does a thing",
      type: "convention",
      body: "# Body",
      source: "imported_url",
      evidence_files: ["https://raw.githubusercontent.com/org/repo/main/skill.md"],
    });
    confirmMutateAsync.mockResolvedValue({ id: "sk-1", name: "my-skill" });

    const onClose = vi.fn();
    renderWithIntl(<UrlPanel onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText("https://example.com/skills/security.md"), {
      target: { value: "https://raw.githubusercontent.com/org/repo/main/skill.md" },
    });
    fireEvent.click(screen.getByText("Continue"));

    expect(await screen.findByText("Suggested skill")).toBeInTheDocument();
    expect(screen.getByText("my-skill")).toBeInTheDocument();
    expect(previewMutateAsync).toHaveBeenCalledWith("https://raw.githubusercontent.com/org/repo/main/skill.md");

    fireEvent.click(screen.getByText("Continue"));
    expect(await screen.findByText("Review before import")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Import from URL"));
    expect(confirmMutateAsync).toHaveBeenCalledWith({
      name: "my-skill",
      description: "does a thing",
      type: "convention",
      body: "# Body",
      source: "imported_url",
    });

    expect(await screen.findByText('Imported "my-skill". Disabled until you vet + enable it.')).toBeInTheDocument();
  });
});
