# Skills — server

Adds the missing Skill-entity CRUD module and the one behavior change that
makes linked skills actually affect a review: today `agent_skills` links
exist and can be listed/reordered via `agents/:id/skills`, but
`ReviewRunExecutor.runOneAgent` never resolves them into the `reviewPullRequest`
call — linked skills currently have zero effect on output.

No new tables. `skills`, `skill_versions` (`src/db/schema/skills.ts`) and
`agent_skills` (`src/db/schema/agents.ts`) already exist, already covered by
`0000_init.sql`. No migration in this spec.

## Data already in place (reused, not rebuilt)

```ts
// src/db/schema/skills.ts
skills:        { id, workspaceId, name, description, type, source, body, enabled, version, evidenceFiles, createdAt }
skillVersions: { skillId, version, body, createdAt }  // PK (skillId, version)

// src/db/schema/agents.ts
agentSkills:   { agentId, skillId, order }             // PK (agentId, skillId)
```

`type: 'rubric'|'convention'|'security'|'custom'`,
`source: 'manual'|'imported_url'|'extracted'|'community'` — both already Zod
enums in `src/vendor/shared/contracts/knowledge.ts` (`SkillType`, `SkillSource`).

## Per-agent attach/enable — no new column

The agent-editor Skills-tab checkbox ("is this skill active for this agent")
is modeled as **link existence**, not a new `enabled` column on `agent_skills`.
Reasoning: `AgentsRepository.setSkills` (`src/modules/agents/repository.ts`)
already does delete-all-then-reinsert-with-`order`-as-array-index; checking a
box adds the id to that array, unchecking removes it. The *global*
`skills.enabled` flag is a separate axis (a skill can be globally on but
unchecked for a given agent, matching the design mockup where
`phantom-api-gate` is globally off yet still listed, unchecked, per agent).
This means **`GET/POST /agents/:id/skills` do not change** — the new Skills
module only adds the entity-level CRUD that was missing.

`AgentsRepository.setSkills` (delete-all-then-reinsert, no transaction
wrapper today) is an existing, pre-feature implementation detail — but the
new Agent-editor drag-to-reorder UI will call it far more frequently and with
tighter timing (once per drop) than any current caller, meaningfully
increasing exposure to an interleaved delete/insert race if two reorders
land concurrently. Wrap the delete+reinsert in `db.transaction()` as part of
this feature rather than leaving the existing untransacted version exposed
to new, higher-frequency traffic.

## New module: `src/modules/skills/`

Mirrors `src/modules/agents/` layering 1:1 (repository / service / helpers /
constants / routes; DI via `container.skillsRepo` getter in
`src/platform/container.ts`, same pattern as `container.agentsRepo`).

### Versioning

Same append-only-snapshot pattern as `agent_versions`, simpler (a skill
version is just a `body` string, not a JSON config):

```ts
// repository.ts, mirrors AgentsRepository.insert/update/snapshotVersion
insert(row)  -> version = 1, snapshotVersion(row.id, 1, row.body)
update(row, patch) ->
  isBodyChange(existing, patch)   // true for name/description/type/body; NOT for `enabled`
    ? version = existing.version + 1, snapshotVersion(...)
    : version unchanged
```

`isBodyChange` mirrors `helpers.ts`'s existing `isConfigChange` for Agents —
toggling `enabled` alone must not bump `version` (consistent with how
`AgentsRepository.update` treats `enabled`).

### Routes

```
GET    /skills                       list (workspace-scoped)
GET    /skills/:id                   one skill
POST   /skills                       create
PUT    /skills/:id                   update / toggle enabled (versions on body change)
DELETE /skills/:id                   delete (cascades agent_skills via FK)
GET    /skills/:id/versions          history, newest first
GET    /skills/:id/versions/:version one snapshot
POST   /skills/import/preview        parse an uploaded file/archive -> suggested Skill fields, NOT persisted
POST   /skills/import                confirm-create from a previewed payload; SERVER sets source + enabled:false
```

`IdParams`/`VersionParams` reused from `src/modules/_shared/schemas.ts`,
`getContext()` for workspace scoping — identical pattern to
`src/modules/agents/routes.ts`. Register in `src/modules/index.ts`.

## Wiring skills into a real review run

`src/modules/reviews/run-executor.ts`, `ReviewRunExecutor.runOneAgent`
(~line 190, right where `callersDigest`/`repoMap` are already conditionally
built): resolve, format, and pass skill bodies.

```ts
// AgentsRepository.linkedSkills(agentId) returns LinkedSkillRow[] =
// { skill: SkillRow; order: number }[] — fields live on `.skill`, not on
// the row itself.
const linked = await this.agents.linkedSkills(agent.id);           // already exists, ordered by `order`
const skillBodies = linked
  .filter((l) => l.skill.enabled)
  .map((l) => {
    const block = `### ${l.skill.name}\n${l.skill.body}`;
    return l.skill.source === 'manual' ? block : wrapUntrusted(l.skill.name, block);
  });

const outcome = await reviewPullRequest({
  // ...existing fields unchanged...
  skills: skillBodies,   // NEW — was omitted entirely before this spec
});
```

`wrapUntrusted` is imported from `@devdigest/reviewer-core` (already exported
from `reviewer-core/src/index.ts`) — **no reviewer-core code changes**.
`PromptParts.skills` is typed as plain `string[]`; per reviewer-core's own
contract ("the caller turns skill slugs into bodies"), formatting and trust
classification are the caller's job. This is also why per-skill headers
(`### <name>`) are added here rather than in `assemblePrompt` — it keeps the
existing `## Skills / rules\n${skills.join('\n\n')}` rendering in
`reviewer-core/src/prompt.ts` completely untouched while still giving each
skill a distinguishable heading in the trace.

### Trust model

| `skill.source` | Treatment in prompt |
|---|---|
| `manual` | Concatenated as-is — workspace-authored, same trust level as `system_prompt` |
| `imported_url` / `extracted` / `community` | Wrapped in `wrapUntrusted(name, block)` — matches `prompt.ts`'s own comment ("community skills should be sanitized upstream") and the requirement that "someone else's skill is someone else's instructions in the agent's prompt" |

**`source` and `enabled` at creation time are server-decided, not
client-supplied** — otherwise this trust split is trivially bypassed (a user
pastes an imported skill's body into the plain create form, which would send
`source: 'manual'`, and it gets full trusted treatment). Two separate write
paths enforce this:

- `POST /skills` (plain create/manual edit) — the service **ignores any
  `source` in the request body and always persists `source: 'manual'`**.
  There is no way to reach `imported_url`/`extracted`/`community` through
  this route. `enabled` defaults to whatever the client sends (default
  `true`) — manual skills are trusted by construction, so no extra gate.
- `POST /skills/import` (confirm-import, new — see Import below) is the
  *only* route that can create a skill with a non-`manual` `source`, and it
  **always forces `enabled: false`** on creation regardless of client input.
  A freshly-imported skill is inert (excluded from `linkedSkills` filtering
  above) until someone reviews its body and flips it on from the Skills list
  — matching the vetting flow already implied by the pre-seeded
  `client/messages/en/skills.json` copy (`needsVetting`/`vettingTitle:
  "Untrusted source — vet before enabling"`, `"Disabled until you vet +
  enable it."`), which neither this spec nor the client spec should silently
  drop.
- `PUT /skills/:id` never allows changing `source` after creation (immutable
  provenance) — only `enabled`/`name`/`description`/`type`/`body` are
  patchable.

## Trace: skills block + token count

`RunTrace.prompt_assembly.skills` is already populated end-to-end once the
wiring above lands (`assemblePrompt` already sets `assembly.skills`, already
persisted to `run_traces`, already rendered as a distinct block in
`RunTraceDrawer`/`TraceBody.tsx`) — **that part needs no server change**.

One extension: add `token_counts?: { skills?: number }` to `PromptAssembly`
(`src/vendor/shared/contracts/trace.ts`), computed with the existing
`TiktokenTokenizer` port (`src/adapters/tokenizer/index.ts`, currently only
used for repo-map budgeting under `modules/repo-intel` — its header comment
scopes it there and should be updated when reused here) over the joined
`skillBodies` string.

**Compute and attach this inline in `ReviewRunExecutor.runOneAgent`**, where
the `RunTrace` object is already built as an inline literal (`run-executor.ts`,
~lines 256-286) — this run does **not** go through
`src/platform/trace-builder.ts`'s `buildRunTrace()`, which is a separate
helper used by the A5 multi-agent/built-in-detector path. Do not add the
field there under the assumption the two paths share trace construction.

**Must hand-mirror this contract change into `client/src/vendor/shared/contracts/trace.ts`**
— the two vendor copies have no sync tooling (`server/insights.md`, Open
Questions).

## Import

No multipart or archive-reading dependency exists in this repo today
(confirmed: no `@fastify/multipart`, no `fflate`/`adm-zip`/`unzipper` in
`package.json` — a prior, reverted branch did add `fflate` for a similar
extraction feature per git history, confirming it's a reasonable choice).
Two routes, both stateless w.r.t. the filesystem (nothing is written to disk,
everything happens in memory against the upload buffer):

- **`POST /skills/import/preview`** — parses an uploaded `.md`/`.txt`/`.zip`,
  returns a suggested `{ name, description, type, body, source, evidence_files }`
  **without persisting anything**. For `.zip`:
  - Only `.md`/`.txt` entries are read; every other entry (scripts, binaries,
    any other extension) is reported back as `{ path, ignored: true }` and
    its bytes are **never read past the entry name/size in the central
    directory** — nothing in an archive is executed, ever.
  - Core selection: a top-level `SKILL.md` wins if present, else the first
    markdown file found becomes `body`; a single `.md`/`.txt` upload (not a
    zip) is used directly as `body`.
  - `source` in the preview is `'extracted'` for a zip (the core is extracted
    from a larger bundle) and `'imported_url'` for a single markdown/text
    file upload — matching the design mockup's generic "Imported" badge on
    the one non-manual, non-community skill shown (`phantom-api-gate`).
  - Optional light front-matter parse (`name:`/`description:`/`type:` at the
    top of the markdown) to pre-fill suggested fields.
  - Guards: cap total upload size, cap total decompressed size (zip-bomb
    guard), **and cap total entry count** (a many-tiny-files zip can still
    cause excessive iteration under a byte cap alone) — check the `security`
    skill's file-upload guidance before implementing.
- **`POST /skills/import` (confirm)** — takes the (possibly user-edited)
  previewed fields, persists a `Skill` row. The server, not the client,
  fixes `source` to whatever the preview computed and forces `enabled: false`
  — see Trust model above. This is a distinct route from `POST /skills`
  specifically so the plain create path can never produce a non-`manual`,
  trust-bypassing row.

## Reproducibility (new agents + fixtures)

The two new reviewer agents (Test Quality Reviewer, API Contract Reviewer)
and their manual-controlled-experiment skills should be added to
`server/src/db/seed.ts`'s `seedAgents`-array mechanism (the existing,
idempotent demo-data path — same one that seeds `acme/payments-api` #482)
rather than created ad hoc through the UI only. This keeps them
reproducible across environments and available to `e2e` fixtures. See
`client/specs/skills.md` for the corresponding fixture-PR/e2e-flow note.

## Explicitly not doing

- No `enabled` column on `agent_skills` (see above — link existence covers it).
- No changes to `reviewer-core/src/prompt.ts` or `PromptParts` — the `skills`
  slot and its rendering already exist and are correct as-is.
- No CI/`.devdigest/skills/<slug>.md` filesystem resolution — that's the
  GitHub Action runner path (`AgentManifest.skills` in `eval-ci.ts`), and no
  runner package exists in this repo to wire it into.
- No `eval_cases`/`eval_runs` scoring logic — Evals stays out of scope for
  this feature (see `client/specs/skills.md`).
- No changes to `pr-self-review` — it classifies diffs by existing
  `client/**`/`server/**`/`reviewer-core/**` globs, which already cover every
  file this feature touches.
