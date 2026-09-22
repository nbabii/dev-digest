import type { Container } from '../../platform/container.js';
import type { Skill, SkillSource, SkillType } from '@devdigest/shared';
import { SkillsRepository } from './repository.js';
import { toSkillDto, toSkillVersionDto, type SkillVersionDto } from './helpers.js';

/**
 * Skills service. Business logic for the Skills list/editor and the import
 * flow. Mirrors `modules/agents/service.ts`.
 *
 * A Skill = name + description + type + body + enabled, versioned via
 * `skill_versions` on every body-affecting change (repository).
 */

export interface CreateSkillInput {
  name: string;
  description?: string;
  type: SkillType;
  body: string;
  enabled?: boolean;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

/** Only the two sources an import can actually produce — see routes.ts's
 *  `ImportSource` enum, which is what actually enforces this at the edge. */
export type ImportableSkillSource = Extract<SkillSource, 'imported_url' | 'extracted'>;

export interface ConfirmImportInput {
  name: string;
  description?: string;
  type: SkillType;
  body: string;
  source: ImportableSkillSource;
  evidence_files?: string[];
}

export class SkillsService {
  private repo: SkillsRepository;

  constructor(private container: Container) {
    this.repo = new SkillsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    const counts = await this.repo.agentCounts(rows.map((r) => r.id));
    return rows.map((row) => toSkillDto(row, counts.get(row.id) ?? 0));
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    if (!row) return undefined;
    const counts = await this.repo.agentCounts([row.id]);
    return toSkillDto(row, counts.get(row.id) ?? 0);
  }

  /** Delete a skill (and its versions/agent-links, via cascade). */
  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /**
   * Plain create (`POST /skills`). SECURITY: always persists `source:
   * 'manual'` — the caller has no way to influence this, by construction
   * (CreateSkillInput has no `source` field at all, and this method ignores
   * anything else regardless). See server/specs/skills.md's Trust model:
   * this is what keeps a pasted-in imported body from ever getting the fully
   * trusted (un-wrapped) treatment `manual` skills receive in a review prompt.
   */
  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      type: input.type,
      body: input.body,
      source: 'manual',
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    });
    // A brand-new skill can't have any agent_skills rows yet.
    return toSkillDto(row, 0);
  }

  /**
   * Confirm-import create (`POST /skills/import`). The route's Zod body
   * schema restricts `source` to `imported_url` | `extracted` — `manual` and
   * `community` are unreachable through this path. `enabled` is ALWAYS
   * forced `false` here regardless of any client input: a freshly-imported
   * skill is inert until a human reviews its body and flips it on (matches
   * the vetting flow — see server/specs/skills.md's Trust model).
   */
  async confirmImport(workspaceId: string, input: ConfirmImportInput): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      type: input.type,
      body: input.body,
      source: input.source,
      enabled: false,
      ...(input.evidence_files !== undefined ? { evidenceFiles: input.evidence_files } : {}),
    });
    // A brand-new skill can't have any agent_skills rows yet.
    return toSkillDto(row, 0);
  }

  /**
   * Update a skill. `source` is never patchable here (immutable provenance,
   * enforced by UpdateSkillInput simply not having the field) — only
   * name/description/type/body/enabled can change.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    });
    if (!row) return undefined;
    const counts = await this.repo.agentCounts([row.id]);
    return toSkillDto(row, counts.get(row.id) ?? 0);
  }

  /**
   * Version history for a skill, newest first. Workspace-scoped: returns
   * undefined when the skill isn't in this workspace (route maps that to 404).
   */
  async listVersions(workspaceId: string, skillId: string): Promise<SkillVersionDto[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(skillId);
    return rows.map(toSkillVersionDto);
  }

  /**
   * A single body snapshot for a skill. Returns undefined when the skill
   * isn't in this workspace OR that version was never recorded (route → 404).
   */
  async getVersion(
    workspaceId: string,
    skillId: string,
    version: number,
  ): Promise<SkillVersionDto | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const row = await this.repo.getVersion(skillId, version);
    return row ? toSkillVersionDto(row) : undefined;
  }
}
