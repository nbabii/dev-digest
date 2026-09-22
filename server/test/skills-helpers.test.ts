import { describe, it, expect } from 'vitest';
import { isBodyChange, toSkillDto, toSkillVersionDto } from '../src/modules/skills/helpers.js';
import type { SkillRow, SkillVersionRow } from '../src/modules/skills/repository.js';

/**
 * Unit coverage for the skills module's pure helpers — DB row ⇄ DTO mapping
 * and the version-bump rule. Mirrors the shape of test/reviews-helpers.test.ts.
 */

const BASE_ROW: SkillRow = {
  id: 's1',
  workspaceId: 'w1',
  name: 'test-coverage-nudge',
  description: 'Nudges toward edge-case coverage.',
  type: 'rubric',
  source: 'manual',
  body: 'Check for edge cases.',
  enabled: true,
  version: 3,
  evidenceFiles: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

describe('toSkillDto', () => {
  it('maps every field, including null evidence_files', () => {
    const dto = toSkillDto(BASE_ROW, 2);
    expect(dto).toEqual({
      id: 's1',
      name: 'test-coverage-nudge',
      description: 'Nudges toward edge-case coverage.',
      type: 'rubric',
      source: 'manual',
      body: 'Check for edge cases.',
      enabled: true,
      version: 3,
      evidence_files: null,
      agent_count: 2,
    });
  });

  it('passes through evidence_files when present (import provenance)', () => {
    const dto = toSkillDto({ ...BASE_ROW, source: 'extracted', evidenceFiles: ['SKILL.md'] }, 0);
    expect(dto.source).toBe('extracted');
    expect(dto.evidence_files).toEqual(['SKILL.md']);
  });

  it('reports agent_count as given, independent of the row itself', () => {
    expect(toSkillDto(BASE_ROW, 0).agent_count).toBe(0);
    expect(toSkillDto(BASE_ROW, 5).agent_count).toBe(5);
  });
});

describe('toSkillVersionDto', () => {
  it('maps a skill_versions row to its DTO', () => {
    const row: SkillVersionRow = {
      skillId: 's1',
      version: 2,
      body: 'v2 body',
      createdAt: new Date('2026-02-01T00:00:00Z'),
    };
    expect(toSkillVersionDto(row)).toEqual({
      skill_id: 's1',
      version: 2,
      body: 'v2 body',
      created_at: '2026-02-01T00:00:00.000Z',
    });
  });
});

describe('isBodyChange', () => {
  const existing = {
    name: 'n',
    description: 'd',
    type: 'rubric' as const,
    body: 'b',
  };

  it('is false for an empty patch', () => {
    expect(isBodyChange(existing, {})).toBe(false);
  });

  it('is false when the patch repeats the existing values', () => {
    expect(isBodyChange(existing, { name: 'n', body: 'b' })).toBe(false);
  });

  it('is true when name/description/type/body actually change', () => {
    expect(isBodyChange(existing, { name: 'new-name' })).toBe(true);
    expect(isBodyChange(existing, { description: 'new-desc' })).toBe(true);
    expect(isBodyChange(existing, { type: 'security' })).toBe(true);
    expect(isBodyChange(existing, { body: 'new body' })).toBe(true);
  });

  it('is false when only `enabled` would change — enabled is not part of the patch shape', () => {
    // `enabled` isn't even a field on BodyChangePatch — toggling it can never
    // bump the version, by construction (mirrors AgentsRepository.update's
    // isConfigChange treatment of `enabled`).
    expect(isBodyChange(existing, {})).toBe(false);
  });
});
