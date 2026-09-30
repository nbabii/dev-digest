import { describe, expect, it, vi } from 'vitest';
import { McpToolError } from '../src/errors.js';
import { ApiError, type DevDigestApi, type FindingRecord, type ReviewRecord, type RunSummary } from '../src/ports.js';
import { createFindingsService } from '../src/services/findings.js';
import { createResolver } from '../src/services/resolve.js';
import { createRunReviewService } from '../src/services/run-review.js';

const REPO = { id: 'r1', owner: 'Acme', name: 'Web', full_name: 'Acme/Web' };
const agent = (o: Partial<{ id: string; name: string; enabled: boolean }> = {}) => ({
  id: 'a1', name: 'Security', description: 'd', provider: 'openai', model: 'm', enabled: true, ...o,
});
const run = (o: Partial<RunSummary> = {}): RunSummary => ({
  run_id: 'run1', agent_id: 'a1', agent_name: 'Security', status: 'running', error: null,
  findings_count: null, score: null, ran_at: null, ...o,
});
const finding = (o: Partial<FindingRecord> = {}): FindingRecord => ({
  id: 'f1', severity: 'WARNING', category: 'bug', title: 't', file: 'a.ts', start_line: 1, end_line: 2,
  rationale: 'r', suggestion: null, confidence: 0.9, accepted_at: null, dismissed_at: null, ...o,
});
const review = (o: Partial<ReviewRecord> = {}): ReviewRecord => ({
  run_id: 'run1', agent_id: 'a1', verdict: 'comment', summary: null, score: 80,
  created_at: '2026-01-01', findings: [finding()], ...o,
});

function fakeApi(o: Partial<Record<keyof DevDigestApi, unknown>> = {}) {
  return {
    listRepos: vi.fn(async () => [REPO]),
    listPulls: vi.fn(async () => [{ id: 'pr1', number: 7, title: 't', head_sha: 'x', status: 'open' }]),
    listAgents: vi.fn(async () => [agent()]),
    startReview: vi.fn(async () => ({ pr_id: 'pr1', runs: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'Security' }] })),
    activeRuns: vi.fn(async () => []),
    listRuns: vi.fn(async () => [run({ status: 'done' })]),
    reviewsForPull: vi.fn(async () => [review()]),
    conventions: vi.fn(async () => ({ scan: null, candidates: [] })),
    ...o,
  } as unknown as DevDigestApi & { [K in keyof DevDigestApi]: ReturnType<typeof vi.fn> };
}

const rejects = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { return e as McpToolError; }
  throw new Error('expected rejection');
};

describe('resolver', () => {
  it('matches repo case-insensitively', async () => {
    const r = createResolver(fakeApi());
    expect((await r.repo('acme/WEB')).id).toBe('r1');
  });

  it('rejects malformed and unknown repos with known list and next step', async () => {
    const r = createResolver(fakeApi());
    const a = await rejects(r.repo('acme'));
    expect(a).toBeInstanceOf(McpToolError);
    expect(a.text).toContain('owner/name');
    expect(a.text).toContain('Acme/Web');
    expect((await rejects(r.repo('a/b/c'))).text).toContain('owner/name');
    expect((await rejects(r.repo('x/y'))).text).toContain('Acme/Web');
  });

  it('lists at most 5 known repos', async () => {
    const repos = Array.from({ length: 8 }, (_, i) => ({ ...REPO, id: `r${i}`, full_name: `o/n${i}` }));
    const e = await rejects(createResolver(fakeApi({ listRepos: vi.fn(async () => repos) })).repo('zzz'));
    expect(e.text).toContain('o/n4');
    expect(e.text).not.toContain('o/n5');
  });

  it('caches repos for 60s using injected now', async () => {
    const api = fakeApi();
    let t = 0;
    const r = createResolver(api, { now: () => t });
    await r.repo('Acme/Web');
    t = 59_000;
    await r.repo('Acme/Web');
    expect(api.listRepos).toHaveBeenCalledTimes(1);
    t = 61_000;
    await r.repo('Acme/Web');
    expect(api.listRepos).toHaveBeenCalledTimes(2);
  });

  it('resolves PR ids, caches them, skips entries without id, names listed PRs on miss', async () => {
    const api = fakeApi({
      listPulls: vi.fn(async () => [
        { id: null, number: 7, title: '', head_sha: '', status: 'open' },
        { id: 'pr7', number: 7, title: '', head_sha: '', status: 'open' },
        { number: 9, title: '', head_sha: '', status: 'open' },
        { id: 'pr3', number: 3, title: '', head_sha: '', status: 'open' },
      ]),
    });
    const r = createResolver(api);
    expect(await r.pull('r1', 7)).toBe('pr7');
    expect(await r.pull('r1', 7)).toBe('pr7');
    expect(api.listPulls).toHaveBeenCalledTimes(1);
    const e = await rejects(r.pull('r1', 9));
    expect(e.text).toContain('#7');
    expect(e.text).toContain('#3');
    expect(e.text).not.toContain('#9,');
  });

  it('resolves agents by id, then name; errors guide forward', async () => {
    const api = fakeApi({
      listAgents: vi.fn(async () => [
        agent({ id: 'a1', name: 'Security' }),
        agent({ id: 'a2', name: 'Dup' }),
        agent({ id: 'a3', name: 'dup' }),
        agent({ id: 'a4', name: 'Off', enabled: false }),
        agent({ id: 'Perf', name: 'Other' }),
      ]),
    });
    const r = createResolver(api);
    expect((await r.agent('a1')).id).toBe('a1');
    expect((await r.agent('security')).id).toBe('a1');
    expect((await r.agent('Perf')).id).toBe('Perf');
    expect((await rejects(r.agent('nope'))).text).toMatch(/not found.*list_agents/);
    expect((await rejects(r.agent('dup'))).text).toMatch(/2 agents named.*pass the id from list_agents/);
    expect((await rejects(r.agent('Off'))).text).toMatch(/disabled.*Next:/);
  });

  it('lets ApiError propagate untouched', async () => {
    const err = new ApiError('unreachable', 'down');
    const r = createResolver(fakeApi({ listRepos: vi.fn(async () => { throw err; }) }));
    await expect(r.repo('a/b')).rejects.toBe(err);
  });
});

function setup(api: ReturnType<typeof fakeApi>, o: { waitMs?: number } = {}) {
  let t = 0;
  const sleeps: number[] = [];
  const svc = createRunReviewService(api, createResolver(api), {
    waitMs: o.waitMs ?? 10_000,
    pollMs: 1_000,
    now: () => t,
    sleep: async (ms) => { sleeps.push(ms); t += ms; },
  });
  return { svc, sleeps };
}
const input = { repo: 'Acme/Web', pr: 7, agent: 'Security' };

describe('run-review', () => {
  it('done path: polls until done then returns shaped review', async () => {
    const api = fakeApi({
      listRuns: vi.fn()
        .mockResolvedValueOnce([run()])
        .mockResolvedValue([run({ status: 'done' })]),
    });
    const { svc, sleeps } = setup(api);
    const res = await svc.runAgentOnPr(input);
    expect(res).toMatchObject({ status: 'done', run_id: 'run1', verdict: 'comment', total: 1 });
    expect(api.startReview).toHaveBeenCalledWith('pr1', 'a1');
    expect(sleeps).toEqual([1_000]);
  });

  it('done but no review record -> error with next step', async () => {
    const api = fakeApi({ reviewsForPull: vi.fn(async () => []) });
    const e = await rejects(setup(api).svc.runAgentOnPr(input));
    expect(e.text).toContain('Next:');
  });

  it('timeout -> running with run_id and hint', async () => {
    const api = fakeApi({ listRuns: vi.fn(async () => [run()]) });
    const res = await setup(api, { waitMs: 3_000 }).svc.runAgentOnPr(input);
    expect(res).toEqual({ status: 'running', run_id: 'run1', hint: 'still running; read it later with get_findings(run_id)' });
  });

  it('attaches to an active run of the same agent without startReview', async () => {
    const api = fakeApi({
      activeRuns: vi.fn(async () => [
        { run_id: 'other', agent_id: 'a9', agent_name: 'x', ran_at: null },
        { run_id: 'runA', agent_id: 'a1', agent_name: 'Security', ran_at: null },
      ]),
      listRuns: vi.fn(async () => [run({ run_id: 'runA', status: 'done' })]),
      reviewsForPull: vi.fn(async () => [review({ run_id: 'runA' })]),
    });
    const res = await setup(api).svc.runAgentOnPr(input);
    expect(api.startReview).not.toHaveBeenCalled();
    expect(res.run_id).toBe('runA');
  });

  it('concurrent calls make exactly one startReview', async () => {
    const api = fakeApi();
    const { svc } = setup(api);
    const [a, b] = await Promise.all([svc.runAgentOnPr(input), svc.runAgentOnPr(input)]);
    expect(api.startReview).toHaveBeenCalledTimes(1);
    expect(a.run_id).toBe(b.run_id);
  });

  it('rate_limited while waiting backs off by retryAfterMs, then returns running', async () => {
    const api = fakeApi({
      listRuns: vi.fn(async () => { throw new ApiError('rate_limited', 'slow', { status: 429, retryAfterMs: 7_000 }); }),
    });
    const { svc, sleeps } = setup(api, { waitMs: 600_000 });
    const res = await svc.runAgentOnPr(input);
    expect(res).toMatchObject({ status: 'running', run_id: 'run1' });
    expect(sleeps.length).toBeGreaterThan(0);
    expect(sleeps.every((s) => s === 7_000)).toBe(true);
  });

  it('rate_limited without retryAfterMs defaults to 5000', async () => {
    const api = fakeApi({ listRuns: vi.fn(async () => { throw new ApiError('rate_limited', 'slow'); }) });
    const s = setup(api, { waitMs: 600_000 });
    await s.svc.runAgentOnPr(input);
    expect(s.sleeps[0]).toBe(5_000);
  });

  it.each(['failed', 'cancelled'] as const)('%s run -> status + capped error, no stack', async (status) => {
    const long = `boom ${'x'.repeat(1000)}\n    at foo (file.ts:1:1)\n    at bar (file.ts:2:2)`;
    const api = fakeApi({ listRuns: vi.fn(async () => [run({ status, error: long })]) });
    const res = await setup(api).svc.runAgentOnPr(input);
    expect(res.status).toBe(status);
    const err = (res as { error: string }).error;
    expect(err.length).toBeLessThanOrEqual(300);
    expect(err).not.toMatch(/\bat \w+ \(/);
    expect(api.reviewsForPull).not.toHaveBeenCalled();
  });

  it('startReview 429 propagates', async () => {
    const err = new ApiError('rate_limited', 'too many', { status: 429, retryAfterMs: 1000 });
    const api = fakeApi({ startReview: vi.fn(async () => { throw err; }) });
    await expect(setup(api).svc.runAgentOnPr(input)).rejects.toBe(err);
  });

  it('clears single-flight after failure so a retry can start again', async () => {
    const err = new ApiError('http', 'x', { status: 500 });
    const api = fakeApi({ startReview: vi.fn().mockRejectedValueOnce(err).mockResolvedValue({ pr_id: 'pr1', runs: [{ run_id: 'run1', agent_id: 'a1', agent_name: 'S' }] }) });
    const { svc } = setup(api);
    await expect(svc.runAgentOnPr(input)).rejects.toBe(err);
    expect((await svc.runAgentOnPr(input)).status).toBe('done');
  });

  it('applies severity and format options to the done result', async () => {
    const api = fakeApi({
      reviewsForPull: vi.fn(async () => [review({ findings: [finding({ id: 'a', severity: 'SUGGESTION' }), finding({ id: 'b', severity: 'CRITICAL' })] })]),
    });
    const res = await setup(api).svc.runAgentOnPr({ ...input, severity: 'critical' });
    expect(res).toMatchObject({ status: 'done', total: 1 });
  });
});

describe('findings', () => {
  const fin = { repo: 'Acme/Web', pr: 7 };

  it('defaults to newest done run and filters review by run_id', async () => {
    const api = fakeApi({
      listRuns: vi.fn(async () => [run({ run_id: 'newRunning', status: 'running' }), run({ run_id: 'newDone', status: 'done' }), run({ run_id: 'old', status: 'done' })]),
      reviewsForPull: vi.fn(async () => [review({ run_id: 'old', score: 1 }), review({ run_id: 'newDone', score: 2 }), review({ run_id: null, score: 3 })]),
    });
    const res = await createFindingsService(api, createResolver(api)).getFindings(fin);
    expect(res.run_id).toBe('newDone');
    expect(res.score).toBe(2);
  });

  it('explicit run_id wins and skips listRuns', async () => {
    const api = fakeApi({ reviewsForPull: vi.fn(async () => [review({ run_id: 'old', score: 1 })]) });
    const res = await createFindingsService(api, createResolver(api)).getFindings({ ...fin, run_id: 'old' });
    expect(res.run_id).toBe('old');
    expect(api.listRuns).not.toHaveBeenCalled();
  });

  it('narrows by agent id, tolerating null agent_id', async () => {
    const api = fakeApi({
      listAgents: vi.fn(async () => [agent({ id: 'a1' }), agent({ id: 'a2', name: 'Perf' })]),
      listRuns: vi.fn(async () => [run({ run_id: 'x', agent_id: null, status: 'done' }), run({ run_id: 'p', agent_id: 'a2', status: 'done' }), run({ run_id: 's', agent_id: 'a1', status: 'done' })]),
      reviewsForPull: vi.fn(async () => [review({ run_id: 'p' }), review({ run_id: 's' })]),
    });
    const res = await createFindingsService(api, createResolver(api)).getFindings({ ...fin, agent: 'Perf' });
    expect(res.run_id).toBe('p');
  });

  it('no runs -> error pointing at run_agent_on_pr', async () => {
    const api = fakeApi({ listRuns: vi.fn(async () => []) });
    const e = await rejects(createFindingsService(api, createResolver(api)).getFindings(fin));
    expect(e.text).toContain('run_agent_on_pr');
  });

  it('runs exist but none done -> distinguishes running and failed', async () => {
    let api = fakeApi({ listRuns: vi.fn(async () => [run({ status: 'running' })]) });
    expect((await rejects(createFindingsService(api, createResolver(api)).getFindings(fin))).text).toMatch(/in progress/);
    api = fakeApi({ listRuns: vi.fn(async () => [run({ status: 'failed' })]) });
    const e = await rejects(createFindingsService(api, createResolver(api)).getFindings(fin));
    expect(e.text).toMatch(/failed or were cancelled/);
    expect(e.text).toContain('run_agent_on_pr');
  });

  it('done run without review record -> helpful error', async () => {
    const api = fakeApi({ reviewsForPull: vi.fn(async () => [review({ run_id: 'other' })]) });
    const e = await rejects(createFindingsService(api, createResolver(api)).getFindings(fin));
    expect(e.text).toContain('no stored review');
    expect(e.text).toContain('Next:');
  });

  it('severity is a minimum level and dismissed findings are excluded', async () => {
    const api = fakeApi({
      reviewsForPull: vi.fn(async () => [review({
        findings: [
          finding({ id: 'c', severity: 'CRITICAL' }),
          finding({ id: 'w', severity: 'WARNING' }),
          finding({ id: 's', severity: 'SUGGESTION' }),
          finding({ id: 'd', severity: 'CRITICAL', dismissed_at: 'x' }),
          finding({ id: 'acc', severity: 'WARNING', accepted_at: 'x', file: 'b.ts' }),
        ],
      })]),
    });
    const svc = createFindingsService(api, createResolver(api));
    expect((await svc.getFindings({ ...fin, severity: 'critical' })).total).toBe(1);
    expect((await svc.getFindings({ ...fin, severity: 'warning' })).total).toBe(3);
    expect((await svc.getFindings(fin)).total).toBe(4);
  });

  it('paginates with cursor', async () => {
    const findings = Array.from({ length: 5 }, (_, i) => finding({ id: `f${i}`, start_line: i, title: `t${i}` }));
    const api = fakeApi({ reviewsForPull: vi.fn(async () => [review({ findings })]) });
    const svc = createFindingsService(api, createResolver(api));
    const p1 = await svc.getFindings({ ...fin, limit: 2 });
    expect(p1.findings).toHaveLength(2);
    expect(p1.truncated).toBe(true);
    const p2 = await svc.getFindings({ ...fin, limit: 2, cursor: p1.next_cursor! });
    expect(p2.findings.map((f) => f.title)).toEqual(['t2', 't3']);
    const p3 = await svc.getFindings({ ...fin, limit: 2, cursor: p2.next_cursor! });
    expect(p3.findings).toHaveLength(1);
    expect(p3.next_cursor).toBeUndefined();
    await expect(svc.getFindings({ ...fin, cursor: '!!bad' })).rejects.toBeInstanceOf(McpToolError);
  });

  it('listAgents projects away system_prompt and keeps id', async () => {
    const api = fakeApi({ listAgents: vi.fn(async () => [{ ...agent(), system_prompt: 'SECRET' }]) });
    const res = await createFindingsService(api, createResolver(api)).listAgents();
    expect(res.agents[0]).toMatchObject({ id: 'a1', name: 'Security' });
    expect(JSON.stringify(res)).not.toContain('SECRET');
  });
});

describe('conventions', () => {
  const cand = (i: number, status = 'accepted') => ({
    id: `c${i}`, category: 'naming', rule: `rule ${i}`, evidence_path: 'a.ts', evidence_line_start: 1,
    evidence_line_end: 2, confidence: 0.8, status,
  });
  const scan = { id: 's', status: 'completed', candidates_found: 1, started_at: 'x' };

  it('no scan -> no_scan with UI hint', async () => {
    const api = fakeApi();
    const res = await createFindingsService(api, createResolver(api)).getConventions({ repo: 'Acme/Web' });
    expect(res).toMatchObject({ status: 'no_scan' });
    expect((res as { hint: string }).hint).toContain('Conventions tab');
  });

  it('excludes rejected candidates', async () => {
    const api = fakeApi({ conventions: vi.fn(async () => ({ scan, candidates: [cand(1), cand(2, 'rejected'), cand(3, 'pending')] })) });
    const res = await createFindingsService(api, createResolver(api)).getConventions({ repo: 'Acme/Web' });
    expect(res).toMatchObject({ status: 'ok', total: 2 });
    expect(JSON.stringify(res)).not.toContain('rule 2');
  });

  it('caps at 50 with truncation hint', async () => {
    const api = fakeApi({ conventions: vi.fn(async () => ({ scan, candidates: Array.from({ length: 80 }, (_, i) => cand(i)) })) });
    const res = await createFindingsService(api, createResolver(api)).getConventions({ repo: 'Acme/Web' });
    if (res.status !== 'ok') throw new Error('unexpected');
    expect(res.conventions).toHaveLength(50);
    expect(res.total).toBe(80);
    expect(res.truncated).toBe(true);
    expect(res.hint).toContain('50 of 80');
  });
});
