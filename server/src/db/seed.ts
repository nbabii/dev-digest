import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
  API_CONTRACT_REVIEWER_PROMPT,
} from './seed-prompts.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, the three built-in agents (General + Security +
 * Performance), and — for the Skills feature — two more agents (Test Quality
 * + API Contract Reviewer), their skills, and two fixture PRs (#501, #502)
 * for the manual controlled experiment described in
 * server/specs/skills.md's "Reproducibility" section. All agents share the
 * default openrouter/deepseek-v4-flash provider+model.
 *
 * Course lessons populate the remaining tables (conventions, memory, eval, …)
 * once their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0 },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 7, deletions: 2 },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
    ]);
  }

  // ---- built-in agents (the three starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  // ---- Skills feature: two fixture PRs + two new agents + their skills ----
  // Reproducible demo data for the manual controlled experiment described in
  // server/specs/skills.md's "Reproducibility" section: run each new agent
  // against its fixture PR with its skill(s) unlinked, then linked, and
  // compare findings + the run trace's Skills block/token count.

  // Fixture PR #501 — a happy-path-only test, for Test Quality Reviewer.
  let [testPr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 501)));
  if (!testPr) {
    [testPr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 501,
        title: 'Add tests for discount calculator',
        author: 'jin.park',
        branch: 'test/discount-calculator',
        base: 'main',
        headSha: 'b2c3d4e5f6a1',
        additions: 15,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: 'Adds unit tests for applyDiscount() ahead of the pricing-page launch.',
      })
      .returning();

    await db.insert(t.prFiles).values([
      {
        prId: testPr!.id,
        path: 'src/utils/discount.test.ts',
        additions: 15,
        deletions: 0,
        // Deliberately happy-path only: no zero/negative/over-100% discount,
        // no zero-price case — the exact gap the Test Quality skills should
        // surface once linked (see docs/agent-prompts/test-quality-reviewer.md).
        patch:
          "@@ -0,0 +1,15 @@\n" +
          "+import { describe, it, expect } from 'vitest';\n" +
          "+import { applyDiscount } from './discount.js';\n" +
          "+\n" +
          "+describe('applyDiscount', () => {\n" +
          "+  it('applies a 10% discount to a normal price', () => {\n" +
          "+    expect(applyDiscount(100, 10)).toBe(90);\n" +
          "+  });\n" +
          "+\n" +
          "+  it('applies a 50% discount to a normal price', () => {\n" +
          "+    expect(applyDiscount(200, 50)).toBe(100);\n" +
          "+  });\n" +
          "+});\n",
      },
    ]);
    await db.insert(t.prCommits).values({
      prId: testPr!.id,
      sha: 'b2c3d4e5f6a1',
      message: 'test: cover the happy path for applyDiscount',
      author: 'jin.park',
    });
  }

  // Fixture PR #502 — a breaking function-signature change, for API Contract
  // Reviewer (drops a param existing callers rely on to opt out of the
  // soft-delete filter).
  let [contractPr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 502)));
  if (!contractPr) {
    [contractPr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 502,
        title: 'Simplify getUserById signature',
        author: 'marisa.koch',
        branch: 'refactor/simplify-get-user',
        base: 'main',
        headSha: 'c3d4e5f6a1b2',
        additions: 4,
        deletions: 7,
        filesCount: 1,
        status: 'needs_review',
        body: 'Cleans up getUserById now that the admin dashboard is the only caller.',
      })
      .returning();

    await db.insert(t.prFiles).values([
      {
        prId: contractPr!.id,
        path: 'src/api/users.ts',
        additions: 4,
        deletions: 7,
        // Drops the `includeDeleted` param silently — a breaking signature
        // change for any other caller passing a second argument. The exact
        // gap the api-contract-guard skill should surface once linked.
        patch:
          '@@ -40,11 +40,8 @@\n' +
          '-export async function getUserById(id: string, includeDeleted = false): Promise<User | null> {\n' +
          '-  return db.query.users.findFirst({\n' +
          '-    where: includeDeleted\n' +
          '-      ? eq(users.id, id)\n' +
          '-      : and(eq(users.id, id), eq(users.deleted, false)),\n' +
          '-  });\n' +
          '-}\n' +
          '+export async function getUserById(id: string): Promise<User | null> {\n' +
          '+  return db.query.users.findFirst({ where: eq(users.id, id) });\n' +
          '+}\n',
      },
    ]);
    await db.insert(t.prCommits).values({
      prId: contractPr!.id,
      sha: 'c3d4e5f6a1b2',
      message: 'refactor: simplify getUserById',
      author: 'marisa.koch',
    });
  }

  // ---- Skills (idempotent upsert-by-name, per workspace) ----
  async function upsertSkill(values: typeof t.skills.$inferInsert): Promise<string> {
    const [existing] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, values.name)));
    if (existing) return existing.id;
    const [row] = await db.insert(t.skills).values(values).returning();
    await db
      .insert(t.skillVersions)
      .values({ skillId: row!.id, version: 1, body: row!.body })
      .onConflictDoNothing();
    return row!.id;
  }

  const testCoverageNudgeId = await upsertSkill({
    workspaceId,
    name: 'test-coverage-nudge',
    description: 'Nudges toward edge-case + error-path coverage, not just the happy path.',
    type: 'rubric',
    source: 'manual',
    enabled: true,
    version: 1,
    body:
      'When reviewing test files or test additions, check:\n' +
      '- The happy path is covered, AND at least one edge case: empty/zero/negative\n' +
      '  input, a boundary value, or invalid/malformed input.\n' +
      '- Error paths are tested (a thrown error, a rejected promise, a non-2xx\n' +
      '  response) — not just the success branch.\n' +
      '- Mocks/stubs are reset between tests and assert on the *shape* of the call\n' +
      '  (arguments), not just that a function "was called".\n' +
      '- Async tests correctly await/return their promises — a missing await can\n' +
      '  let a test pass even when the code under test throws.\n' +
      '\n' +
      'A new test that covers ONLY the happy path for otherwise-risky logic (money,\n' +
      'dates, pagination, auth) is a WARNING-level finding — name the specific\n' +
      'missing case, never a generic "add more tests".',
  });

  // Simulates a skill that went through Import → Preview → Confirm (per the
  // acceptance checklist): `source: 'extracted'` (as a zip-extracted core
  // markdown would produce) with `evidence_files` pointing at the archive
  // entry it was extracted from. Real imports are created disabled pending
  // vetting (see server/specs/skills.md's Trust model); this seed represents
  // a workspace where that vetting already happened, so the controlled
  // experiment below can exercise it enabled out of the box.
  const cornerCaseChecklistId = await upsertSkill({
    workspaceId,
    name: 'corner-case-checklist',
    description: 'Imported corner-case checklist for numeric/collection/date edge cases.',
    type: 'rubric',
    source: 'extracted',
    enabled: true,
    version: 1,
    evidenceFiles: ['corner-cases/SKILL.md'],
    body:
      '# Corner-case checklist (imported)\n\n' +
      "Beyond the happy path, confirm the diff's tests (or, if untested, the code\n" +
      'itself) account for:\n' +
      '- Zero / negative / NaN / Infinity numeric inputs where the domain implies\n' +
      '  only positive values (prices, discounts, quantities, durations).\n' +
      '- Empty collections and single-element collections, not just "a few items".\n' +
      '- Off-by-one boundaries: exactly at a limit, one under, one over.\n' +
      '- Concurrent/duplicate calls (idempotency) for anything that mutates state.\n' +
      '- Locale/timezone edges for date/time logic.\n\n' +
      'If the diff introduces logic in one of these risk categories without a\n' +
      'corresponding edge-case test, report it — cite the specific missing case.',
  });

  const apiContractGuardId = await upsertSkill({
    workspaceId,
    name: 'api-contract-guard',
    description: 'Flags breaking changes to a function or route’s public contract.',
    type: 'convention',
    source: 'manual',
    enabled: true,
    version: 1,
    body:
      "Guard against breaking changes to a function's or route's public contract:\n" +
      '- A function/method signature change that removes, reorders, or narrows the\n' +
      "  type of an existing parameter that call sites elsewhere rely on.\n" +
      "- A route's path, method, required request fields, or response shape\n" +
      '  changes without a version bump or back-compat shim.\n' +
      '- A default value changed for an existing parameter, silently changing\n' +
      "  behavior for existing callers that didn't pass it explicitly.\n" +
      '- An enum/union type that drops a previously-valid member some caller may\n' +
      '  still send/expect.\n\n' +
      'Flag any such change as at least a WARNING (CRITICAL if a call site in this\n' +
      "diff's repo already relies on the old shape and is not updated in the same\n" +
      'diff). Do not flag purely additive, backward-compatible changes.',
  });

  // ---- New agents (Test Quality Reviewer, API Contract Reviewer) ----
  const newAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'Test Quality Reviewer',
      description: 'Judges whether tests actually cover risky logic, not just the happy path.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'API Contract Reviewer',
      description: 'Catches breaking changes to function signatures and route contracts.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: API_CONTRACT_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  const agentIdByName = new Map<string, string>();
  for (const a of newAgents) {
    let [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) [existing] = await db.insert(t.agents).values(a).returning();
    agentIdByName.set(a.name!, existing!.id);
  }

  // ---- Link skills to their agent (idempotent: PK is (agent_id, skill_id)) ----
  const testQualityAgentId = agentIdByName.get('Test Quality Reviewer')!;
  const apiContractAgentId = agentIdByName.get('API Contract Reviewer')!;
  await db
    .insert(t.agentSkills)
    .values([
      { agentId: testQualityAgentId, skillId: testCoverageNudgeId, order: 0 },
      { agentId: testQualityAgentId, skillId: cornerCaseChecklistId, order: 1 },
      { agentId: apiContractAgentId, skillId: apiContractGuardId, order: 0 },
    ])
    .onConflictDoNothing();

  return { workspaceId, userId };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
