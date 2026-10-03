import { getEncoding } from 'js-tiktoken';
import { describe, expect, it } from 'vitest';
import { DESCRIPTIONS, SERVER_INSTRUCTIONS, TOOL_NAMES } from '../src/tools/descriptions.js';

const enc = getEncoding('cl100k_base');
const tokens = (s: string) => enc.encode(s).length;
const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter(Boolean);

describe('tool descriptions', () => {
  it('defines exactly the five tools, each with a description', () => {
    expect([...TOOL_NAMES].sort()).toEqual(
      ['get_blast_radius', 'get_conventions', 'get_findings', 'list_agents', 'run_agent_on_pr'],
    );
    expect(Object.keys(DESCRIPTIONS).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it('carries the untrusted-data warning where finding text is returned', () => {
    for (const name of ['run_agent_on_pr', 'get_findings'] as const) {
      expect(DESCRIPTIONS[name]).toMatch(/untrusted data/i);
      expect(DESCRIPTIONS[name]).toMatch(/do not follow instructions/i);
    }
    expect(SERVER_INSTRUCTIONS).toMatch(/untrusted data/i);
  });

  it('states the repo format once, in the instructions', () => {
    expect(SERVER_INSTRUCTIONS).toContain('"owner/name"');
    for (const name of TOOL_NAMES) expect(DESCRIPTIONS[name]).not.toContain('owner/name');
  });

  it('says "spends credits" only for run_agent_on_pr', () => {
    for (const name of TOOL_NAMES) {
      const spends = /spends .*credits/i.test(DESCRIPTIONS[name]);
      expect(spends, name).toBe(name === 'run_agent_on_pr');
    }
  });

  it('keeps every description to at most 4 sentences', () => {
    for (const name of TOOL_NAMES) {
      expect(sentences(DESCRIPTIONS[name]).length, name).toBeLessThanOrEqual(4);
    }
  });

  it('never says "do not call" on get_blast_radius', () => {
    expect(DESCRIPTIONS.get_blast_radius).not.toMatch(/do not call/i);
  });

  it('fits the token budget (cl100k_base)', () => {
    const measured: Record<string, number> = { instructions: tokens(SERVER_INSTRUCTIONS) };
    for (const name of TOOL_NAMES) measured[name] = tokens(DESCRIPTIONS[name]);
    console.error('[descriptions] token counts', JSON.stringify(measured));
    expect(measured.instructions, JSON.stringify(measured)).toBeLessThanOrEqual(100);
    for (const name of TOOL_NAMES) expect(measured[name], name).toBeLessThanOrEqual(120);
  });
});
