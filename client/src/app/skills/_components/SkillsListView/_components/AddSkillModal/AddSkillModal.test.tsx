import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import messages from "../../../../../../../messages/en/skills.json";
import { AddSkillModal } from "./AddSkillModal";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

afterEach(cleanup);

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("AddSkillModal (smoke)", () => {
  it("opens on the Create tab by default, with the create form visible", () => {
    renderWithProviders(<AddSkillModal onClose={vi.fn()} />);
    expect(screen.getByText("Add skill")).toBeInTheDocument();
    expect(screen.getByText("Create skill")).toBeInTheDocument();
  });

  it("switches to the From file tab", () => {
    renderWithProviders(<AddSkillModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("From file"));
    expect(screen.getByText("Choose a file…")).toBeInTheDocument();
  });

  it("switches to the Import from URL tab and shows a not-available message", () => {
    renderWithProviders(<AddSkillModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Import from URL"));
    expect(screen.getByText("Not available yet")).toBeInTheDocument();
  });
});
