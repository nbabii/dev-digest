import { describe, expect, it } from 'vitest';
import {
  clampLimit, conciseFinding, decodeCursor, detailedFinding, encodeCursor, estimateTokens,
  meetsMinSeverity, paginate, projectAgent, selectFindings, severityRank, shapeReview, sortFindings,
} from '../src/format.js';
import { McpToolError } from '../src/errors.js';
import type { Agent, FindingRecord, ReviewRecord } from '../src/ports.js';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

function finding(over: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    severity: 'WARNING',
    category: 'bug',
    title: 'Something off',
    file: 'src/a.ts',
    start_line: 10,
    end_line: 12,
    rationale: 'because',
    suggestion: 'fix it',
    confidence: 0.8,
    accepted_at: null,
    dismissed_at: null,
    ...over,
  };
}

describe('severity', () => {
  it('ranks most severe first, unknown last', () => {
    expect(severityRank('CRITICAL')).toBe(0);
    expect(severityRank('warning')).toBe(1);
    expect(severityRank('SUGGESTION')).toBe(2);
    expect(severityRank('WHATEVER')).toBe(3);
  });

  it('filters "this level and above"', () => {
    expect(meetsMinSeverity('CRITICAL', 'warning')).toBe(true);
    expect(meetsMinSeverity('WARNING', 'warning')).toBe(true);
    expect(meetsMinSeverity('SUGGESTION', 'warning')).toBe(false);
    expect(meetsMinSeverity('SUGGESTION', undefined)).toBe(true);
    expect(meetsMinSeverity('WARNING', 'critical')).toBe(false);
  });
});

describe('selection', () => {
  it('excludes dismissed, keeps accepted', () => {
    const out = selectFindings([
      finding({ id: 'a', dismissed_at: '2026-01-01' }),
      finding({ id: 'b', accepted_at: '2026-01-01' }),
      finding({ id: 'c' }),
    ]);
    expect(out.map((f) => f.id)).toEqual(['b', 'c']);
  });

  it('sorts deterministically by severity, file, start_line, id', () => {
    const items = [
      finding({ id: 'd', severity: 'SUGGESTION', file: 'a.ts' }),
      finding({ id: 'c', severity: 'WARNING', file: 'b.ts', start_line: 1 }),
      finding({ id: 'b', severity: 'WARNING', file: 'a.ts', start_line: 9 }),
      finding({ id: 'a', severity: 'WARNING', file: 'a.ts', start_line: 2 }),
      finding({ id: 'z', severity: 'CRITICAL', file: 'z.ts' }),
      finding({ id: 'y', severity: 'WARNING', file: 'a.ts', start_line: 2 }),
    ];
    const expected = ['z', 'a', 'y', 'b', 'c', 'd'];
    expect(sortFindings(items).map((f) => f.id)).toEqual(expected);
    expect(sortFindings([...items].reverse()).map((f) => f.id)).toEqual(expected);
  });

  it('applies the minimum severity', () => {
    const out = selectFindings([finding({ severity: 'SUGGESTION' }), finding({ id: 'w' })], 'warning');
    expect(out.map((f) => f.id)).toEqual(['w']);
  });
});

describe('shaping', () => {
  it('concise has lowercase severity, at, no UUID', () => {
    const c = conciseFinding(finding());
    expect(c).toEqual({ severity: 'warning', title: 'Something off', at: 'src/a.ts:10-12', category: 'bug', suggestion: 'fix it' });
    expect(JSON.stringify(c)).not.toMatch(UUID);
  });

  it('concise omits empty suggestion; detailed adds id, rationale, confidence, accepted', () => {
    expect(conciseFinding(finding({ suggestion: null }))).not.toHaveProperty('suggestion');
    const d = detailedFinding(finding({ accepted_at: 'x' }));
    expect(d.id).toMatch(UUID);
    expect(d).toMatchObject({ rationale: 'because', confidence: 0.8, accepted: true });
  });

  it('caps field lengths', () => {
    expect(conciseFinding(finding({ title: 'x'.repeat(5000) })).title.length).toBeLessThanOrEqual(200);
    expect(detailedFinding(finding({ rationale: 'x'.repeat(5000) })).rationale.length).toBeLessThanOrEqual(1000);
  });

  it('shapeReview builds verdict/score/findings/total', () => {
    const review: ReviewRecord = {
      run_id: 'r1', agent_id: null, verdict: 'approve', summary: null, score: 90, created_at: 'now',
      findings: [finding({ id: 'a' }), finding({ id: 'b', dismissed_at: 'x' })],
    };
    const out = shapeReview(review);
    expect(out).toMatchObject({ run_id: 'r1', verdict: 'approve', score: 90, total: 1 });
    expect(out).not.toHaveProperty('summary');
    expect(out.findings).toHaveLength(1);
  });
});

describe('cursor and pagination', () => {
  it('round-trips', () => {
    expect(decodeCursor(encodeCursor(40))).toBe(40);
  });

  it.each(['', '!!!', 'bm90IGEgY3Vyc29y', Buffer.from('o:-1').toString('base64url'), Buffer.from('x:5').toString('base64url')])(
    'rejects garbage %j with a next step',
    (c) => {
      try {
        decodeCursor(c);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(McpToolError);
        expect((e as McpToolError).text).toMatch(/Next:/);
      }
    },
  );

  it('clamps limit to [1,50], default 20', () => {
    expect(clampLimit(undefined)).toBe(20);
    expect(clampLimit(1000)).toBe(50);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
  });

  it('paginates with cursor and hint', () => {
    const all = Array.from({ length: 87 }, (_, i) => i);
    const p1 = paginate(all);
    expect(p1.items).toHaveLength(20);
    expect(p1.total).toBe(87);
    expect(p1.truncated).toBe(true);
    expect(p1.hint).toContain('showing 20 of 87');
    const p2 = paginate(all, { limit: 500, cursor: p1.next_cursor! });
    expect(p2.items[0]).toBe(20);
    expect(p2.items).toHaveLength(50);
    const last = paginate(all, { cursor: encodeCursor(80) });
    expect(last.items).toHaveLength(7);
    expect(last.next_cursor).toBeUndefined();
    expect(last.truncated).toBeUndefined();
  });
});

describe('estimateTokens', () => {
  it('is ceil(chars/3.5)', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a'.repeat(7))).toBe(2);
    expect(estimateTokens('a'.repeat(8))).toBe(3);
  });
});

describe('projectAgent', () => {
  it('drops system_prompt and unknown fields', () => {
    const raw = { id: 'a1', name: 'n', description: 'd', provider: 'openai', model: 'm', enabled: true, system_prompt: 'SECRET' };
    const out = projectAgent(raw as Agent);
    expect(out).toEqual({ id: 'a1', name: 'n', description: 'd', provider: 'openai', model: 'm', enabled: true });
    expect(JSON.stringify(out)).not.toContain('SECRET');
  });
});
