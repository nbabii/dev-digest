import { createHash } from 'node:crypto';
import { Intent, type IntentSource, type UnifiedDiff } from '@devdigest/shared';
import { wrapUntrusted } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import { loadPromptTemplate } from '../../platform/prompts.js';
import { assertHttpsAndNotBlocked, fetchAsText } from '../../platform/safe-fetch.js';
import { AppError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import type { PullRow } from '../../db/rows.js';
import type * as schema from '../../db/schema.js';
import type { Logger } from './run-executor.js';
import { INTENT_FETCH_LIMITS, MAX_LINKED_DOCS, THIN_DESCRIPTION_CHARS } from './intent-constants.js';

type RepoRow = typeof schema.repos.$inferSelect;

/** One classifier input source, paired with its fetched/derived text (null when not `used`). */
interface ResolvedSource {
  source: IntentSource;
  text: string | null;
}

/**
 * Intent classifier — see docs/plans/intent-layer.md. Lives inside the
 * `reviews` module (Architecture decision 1: `reviews/repository.ts`'s own
 * header already claims ownership of `pr_intent`, and `run-executor.ts`'s
 * docstring already names "diff + intent" as its pre-work). Same shape as
 * `ConventionsService` (a plain, `Container`-constructed service) but
 * WITHOUT job-queue machinery — classification runs synchronously in the
 * request/pre-work path (Architecture decision 3): the input is capped by
 * design (title + description + up to 3 linked docs + hunk headers only, no
 * diff bodies) and the model is flash-tier, so there's no long-running-job
 * failure class (orphaned `status: 'running'` rows) to guard against here.
 */
export class IntentService {
  constructor(private container: Container) {}

  /**
   * Assembles the classifier's input sources: the PR title/description, the
   * linked issue (if the body references one), up to `MAX_LINKED_DOCS`
   * `https://` URLs found in the body, and the changed-files list with hunk
   * HEADERS ONLY (never `diff.raw` or hunk body text — the classifier never
   * sees code). Each source produces exactly one `IntentSource` entry.
   */
  async buildSources(pull: PullRow, repo: RepoRow, diff: UnifiedDiff): Promise<ResolvedSource[]> {
    const resolved: ResolvedSource[] = [];
    const body = pull.body?.trim() ?? '';

    // ---- PR description --------------------------------------------------
    resolved.push({
      source: { kind: 'pr_description', ref: `#${pull.number}`, status: body.length > 0 ? 'used' : 'skipped' },
      text: body.length > 0 ? body : null,
    });

    // ---- Linked issue (GitHub-native "#N" / "closes #N" reference) -------
    // Same extraction regex as OctokitGitHubClient's private
    // `resolveLinkedIssue` (server/src/adapters/github/octokit.ts) —
    // duplicated here because that method isn't exported; this module only
    // needs the number, not a second copy of `getPullRequest`'s full fetch.
    const issueMatch = /(?:closes|fixes|resolves)?\s*#(\d+)/i.exec(pull.body ?? '');
    const linkedIssueNumber = issueMatch?.[1] ? Number(issueMatch[1]) : null;
    if (linkedIssueNumber !== null) {
      try {
        const github = await this.container.github();
        const issue = await github.getIssue({ owner: repo.owner, name: repo.name }, linkedIssueNumber);
        resolved.push({
          source: { kind: 'linked_issue', ref: `#${linkedIssueNumber}`, status: 'used' },
          text: `${issue.title}\n\n${issue.body ?? ''}`.trim(),
        });
      } catch (err) {
        resolved.push({
          source: {
            kind: 'linked_issue',
            ref: `#${linkedIssueNumber}`,
            status: 'unreachable',
            error: classifyFetchError(err),
          },
          text: null,
        });
      }
    }

    // ---- Up to MAX_LINKED_DOCS linked docs --------------------------------
    const docUrls = extractHttpsUrls(pull.body ?? '', linkedIssueNumber).slice(0, MAX_LINKED_DOCS);
    for (const url of docUrls) {
      try {
        assertHttpsAndNotBlocked(url);
        const text = await fetchAsText(url, {
          maxBytes: INTENT_FETCH_LIMITS.MAX_DOC_BYTES,
          timeoutMs: INTENT_FETCH_LIMITS.FETCH_TIMEOUT_MS,
        });
        resolved.push({ source: { kind: 'linked_doc', ref: url, status: 'used' }, text });
      } catch (err) {
        resolved.push({
          source: { kind: 'linked_doc', ref: url, status: 'unreachable', error: classifyFetchError(err) },
          text: null,
        });
      }
    }

    // ---- Changed files + hunk headers only (no code) ----------------------
    resolved.push({
      source: { kind: 'changed_files', ref: `${diff.files.length} file(s)`, status: 'used' },
      text: formatChangedFiles(diff),
    });

    return resolved;
  }

  /**
   * Runs the classifier and persists the result. Pinned to OpenRouter
   * (Architecture decision 5) independent of the main review agent's own
   * provider/model — `resolveFeatureModel` only resolves the MODEL id
   * (workspace override, else the `review_intent` registry default); the
   * provider is always OpenRouter for this feature. Throws on failure — no
   * DB write on a failed classification (Architecture decision 6).
   */
  async classify(
    workspaceId: string,
    pull: PullRow,
    repo: RepoRow,
    diff: UnifiedDiff,
    logger?: Logger,
  ): Promise<Intent> {
    const resolvedSources = await this.buildSources(pull, repo, diff);
    const choice = await resolveFeatureModel(this.container, workspaceId, 'review_intent');
    const llm = await this.container.llm('openrouter');

    const systemPrompt = await loadPromptTemplate('intent-classifier.system.md');
    const userBlocks = resolvedSources
      .map((r) =>
        r.text !== null
          ? wrapUntrusted(r.source.kind, r.text)
          : `<${r.source.kind} status="${r.source.status}" ref="${r.source.ref}" />`,
      )
      .join('\n\n');
    const promptTokenEstimate = this.container.tokenizer.count(userBlocks);

    const result = await llm.completeStructured({
      model: choice.model,
      schema: Intent,
      schemaName: 'pr_intent',
      temperature: 0.2,
      maxRetries: 2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userBlocks },
      ],
    });

    // Ground truth for `sources` is what THIS service actually fetched, not
    // the model's echoed restatement of it — same "never trust the model's
    // self-report" posture as the insufficient_context backstop below and
    // reviewer-core/grounding.ts's mandatory citation gate.
    const sources = resolvedSources.map((r) => r.source);

    // Deterministic insufficient_context backstop: OR'd with the model's own
    // flag, never overriding it to false. Thin/empty description OR any
    // unreachable source is grounds for "treat scope as a loose hint"
    // regardless of how confident the model's own output looks.
    const thinDescription = (pull.body?.trim().length ?? 0) < THIN_DESCRIPTION_CHARS;
    const anyUnreachable = sources.some((s) => s.status === 'unreachable');
    const insufficientContext = result.data.insufficient_context || thinDescription || anyUnreachable;

    const intent: Intent = { ...result.data, insufficient_context: insufficientContext, sources };

    await this.container.reviewRepo.upsertIntent(pull.id, {
      ...intent,
      provider: 'openrouter',
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
      classifiedHeadSha: pull.headSha,
      classifiedBodyHash: hashPrText(pull.title, pull.body),
    });

    // Never log summary/in_scope/out_of_scope text, the raw prompt, the PR
    // body, fetched document text, or a full source URL — kind+status only.
    logger?.info(
      {
        prId: pull.id,
        provider: 'openrouter',
        model: result.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: result.costUsd,
        promptTokenEstimate,
        sources: sources.map((s) => ({ kind: s.kind, status: s.status })),
      },
      'intent: classified',
    );

    return intent;
  }

  /**
   * Reads the stored intent; classifies (and persists) when missing or
   * stale (head SHA or PR-text hash changed since the last classification —
   * Architecture decision 7). Used by both `GET /pulls/:id/intent` and
   * `run-executor.ts`'s pre-work step.
   */
  async getOrClassify(
    workspaceId: string,
    pull: PullRow,
    repo: RepoRow,
    diff: UnifiedDiff,
    logger?: Logger,
  ): Promise<Intent> {
    const stored = await this.container.reviewRepo.getIntent(pull.id);
    if (stored) {
      const bodyHash = hashPrText(pull.title, pull.body);
      if (stored.classifiedHeadSha === pull.headSha && stored.classifiedBodyHash === bodyHash) {
        return {
          summary: stored.summary,
          in_scope: stored.in_scope,
          out_of_scope: stored.out_of_scope,
          confidence: stored.confidence,
          insufficient_context: stored.insufficient_context,
          sources: stored.sources,
        };
      }
    }
    return this.classify(workspaceId, pull, repo, diff, logger);
  }
}

/** sha256(title + body), Node's built-in `crypto` — no new dependency. */
function hashPrText(title: string, body: string | null): string {
  return createHash('sha256').update(`${title}\n${body ?? ''}`).digest('hex');
}

/**
 * Up to `MAX_LINKED_DOCS` distinct `https://` URLs found in the PR body,
 * excluding one that's just a GitHub-native URL form of the already-resolved
 * linked issue (e.g. a full `.../issues/42` link when `#42` was also found).
 */
function extractHttpsUrls(body: string, excludeIssueNumber: number | null): string[] {
  const matches = body.match(/https:\/\/[^\s)>\]}"']+/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  const excludeRe =
    excludeIssueNumber !== null ? new RegExp(`/(?:issues|pull)/${excludeIssueNumber}(?:[/?#]|$)`) : null;
  for (const url of matches) {
    if (seen.has(url)) continue;
    seen.add(url);
    if (excludeRe?.test(url)) continue;
    out.push(url);
  }
  return out;
}

/**
 * Changed-files list with hunk HEADERS ONLY — `file`, `oldStart`/`oldLines`,
 * `newStart`/`newLines`. Never `diff.raw` or any hunk body/line-content text
 * (the classifier must never see code, only shape).
 */
function formatChangedFiles(diff: UnifiedDiff): string {
  return diff.files
    .map((f) => {
      const hunkLines = f.hunks
        .map((h) => `  @@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`)
        .join('\n');
      return `- ${f.path} (+${f.additions}/-${f.deletions})\n${hunkLines}`;
    })
    .join('\n');
}

/**
 * A short, non-leaking classification of a safe-fetch failure — never the
 * raw error message (which could echo internal detail: hostnames, stack
 * fragments, byte counts).
 */
function classifyFetchError(err: unknown): string {
  if (err instanceof AppError) {
    if (err.code === 'validation_error') {
      if (err.message.includes('size limit')) return 'too_large';
      if (err.message.includes('binary content')) return 'not_text';
      if (err.message.includes('not allowed')) return 'blocked_host';
      return 'invalid_url';
    }
    if (err.code === 'external_service_error') {
      return err.message.includes('within') ? 'timeout' : 'unreachable';
    }
  }
  return 'unreachable';
}
