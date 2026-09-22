import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";
import { SkillCard } from "./SkillCard";

afterEach(cleanup);

const SKILL: Skill = {
  id: "sk1",
  name: "PR Quality Rubric",
  description: "Checks tests, naming, and error handling",
  type: "rubric",
  source: "manual",
  body: "# Rule\nDescribe the rule…",
  enabled: true,
  version: 1,
  agent_count: 3,
};

function renderWithIntl(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("SkillCard (smoke)", () => {
  it("renders the skill name, type badge and source badge", () => {
    renderWithIntl(<SkillCard skill={SKILL} />);
    expect(screen.getByText("PR Quality Rubric")).toBeInTheDocument();
    expect(screen.getByText("rubric")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
  });

  it("shows a needs-vetting badge for a disabled, non-manual skill", () => {
    renderWithIntl(<SkillCard skill={{ ...SKILL, source: "imported_url", enabled: false }} />);
    expect(screen.getByText("needs vetting")).toBeInTheDocument();
  });

  it("does not show a needs-vetting badge for an enabled imported skill", () => {
    renderWithIntl(<SkillCard skill={{ ...SKILL, source: "imported_url", enabled: true }} />);
    expect(screen.queryByText("needs vetting")).not.toBeInTheDocument();
  });

  it("falls back to a translated placeholder when description is empty", () => {
    renderWithIntl(<SkillCard skill={{ ...SKILL, description: "" }} />);
    expect(screen.getByText("No description")).toBeInTheDocument();
  });

  it("shows the agent count and version", () => {
    renderWithIntl(<SkillCard skill={SKILL} />);
    expect(screen.getByText("3 agents")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
  });

  it("pluralizes a single agent correctly", () => {
    renderWithIntl(<SkillCard skill={{ ...SKILL, agent_count: 1 }} />);
    expect(screen.getByText("1 agent")).toBeInTheDocument();
  });
});
