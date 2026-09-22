import type { Skill, SkillSource, SkillType } from '@devdigest/shared';
import type { SkillRow, SkillVersionRow } from './repository.js';

/**
 * Pure helpers for the skills module — DB row ⇄ DTO mapping and the
 * version-bump rule. No I/O; mirrors `modules/agents/helpers.ts`.
 */

/** Map a persisted skill row to the public `Skill` DTO. `agentCount` is
 *  looked up separately (via `SkillsRepository.agentCounts`) since it's an
 *  aggregate over `agent_skills`, not a column on `skills` itself. */
export function toSkillDto(row: SkillRow, agentCount: number): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
    agent_count: agentCount,
  };
}

/** Public DTO for a `skill_versions` snapshot row (no shared contract exists
 *  for this yet — Agents' equivalent, `AgentVersion`, carries a structured
 *  `config` object; a skill version is just a body string, so a small local
 *  interface is enough rather than adding a contract for a single string field). */
export interface SkillVersionDto {
  skill_id: string;
  version: number;
  body: string;
  created_at: string;
}

export function toSkillVersionDto(row: SkillVersionRow): SkillVersionDto {
  return {
    skill_id: row.skillId,
    version: row.version,
    body: row.body,
    created_at: row.createdAt.toISOString(),
  };
}

/** Fields whose change bumps the skill's version (everything but `enabled`). */
export interface BodyChangePatch {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
}

/**
 * True when a patch changes name/description/type/body relative to the
 * existing row — toggling `enabled` alone must NOT bump the version (mirrors
 * `modules/agents/helpers.ts`'s `isConfigChange`).
 */
export function isBodyChange(
  existing: Pick<SkillRow, 'name' | 'description' | 'type' | 'body'>,
  patch: BodyChangePatch,
): boolean {
  return (
    (patch.name !== undefined && patch.name !== existing.name) ||
    (patch.description !== undefined && patch.description !== existing.description) ||
    (patch.type !== undefined && patch.type !== existing.type) ||
    (patch.body !== undefined && patch.body !== existing.body)
  );
}
