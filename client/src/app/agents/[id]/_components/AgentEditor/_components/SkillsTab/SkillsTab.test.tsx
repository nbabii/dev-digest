import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentSkillLink, Skill } from "@devdigest/shared";
import agentsMessages from "../../../../../../../../messages/en/agents.json";
import skillsMessages from "../../../../../../../../messages/en/skills.json";

const mutate = vi.fn();

vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useAgentSkillLinks: () => ({
    data: [{ agent_id: "ag1", skill_id: "sk1", order: 0 }] satisfies AgentSkillLink[],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useSetAgentSkills: () => ({ mutate, isPending: false }),
}));

vi.mock("../../../../../../../lib/hooks/skills", () => ({
  useSkills: () => ({
    data: [
      { id: "sk1", name: "PR Quality Rubric", description: "", type: "rubric", source: "manual", body: "", enabled: true, version: 1, agent_count: 1 },
      { id: "sk2", name: "Security Basics", description: "", type: "security", source: "manual", body: "", enabled: true, version: 1, agent_count: 0 },
    ] satisfies Skill[],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

import { SkillsTab } from "./SkillsTab";

afterEach(cleanup);

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages, skills: skillsMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("Agent editor Skills tab (smoke)", () => {
  it("lists every workspace skill and reflects which are linked", () => {
    renderWithIntl(<SkillsTab agent={AGENT} />);
    expect(screen.getByText("PR Quality Rubric")).toBeInTheDocument();
    expect(screen.getByText("Security Basics")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 enabled")).toBeInTheDocument();
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[0]).toHaveAttribute("aria-checked", "true");
    expect(checkboxes[1]).toHaveAttribute("aria-checked", "false");
  });

  it("checking an unlinked skill calls setAgentSkills with the recomputed ordered ids", () => {
    renderWithIntl(<SkillsTab agent={AGENT} />);
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]!);
    expect(mutate).toHaveBeenCalledWith({ agentId: "ag1", skillIds: ["sk1", "sk2"] });
  });
});
