# Skills — client

A new top-level "Skills" area (list + editor) plus one new tab in the
existing Agent editor. Mirrors the Agents feature's structure throughout —
see `server/specs/skills.md` for the API/data-model side (entity CRUD,
per-agent link semantics, trust wrapping, trace token count).

## Why this mirrors Agents so closely

`client/src/vendor/shared/contracts/knowledge.ts` already defines `Skill`,
`SkillType`, `SkillSource`, `AgentSkillLink`; `client/messages/en/agents.json`
already has copy reserved for an agent-editor Skills tab
(`editor.tabs.skills`, `skills.enabledCount`, `skills.orderHint`); `AgentCard.tsx`
already accepts an unused `skillCount?` prop; `client/src/components/app-shell/helpers.ts`'s
`activeKeyFor()` already special-cases a `/skills` route. None of this is
wired up today — this spec is filling in an already-anticipated shape, not
inventing a new one.

**`client/messages/en/skills.json` already describes a fully worked-out add-skill
UX**, not just placeholder strings: a drawer with `drawer.tabs.file/url/community`,
a "From file" tab that pastes a body directly, a "From URL" server-fetch tab,
a "Community" catalog-search tab, and explicit vetting language
(`needsVetting`/`vettingTitle: "Untrusted source — vet before enabling"`,
`url.success: "Imported \"{name}\". Disabled until you vet + enable it."`).
The Import section below reconciles this repo's own explicit written
requirement (upload a markdown file **or archive**, preview before saving,
never execute archive contents) with that seeded design, rather than
replacing it outright — see there for what's kept, changed, and deferred.

## Skills list page

`client/src/app/skills/page.tsx` + `_components/SkillsListView/` — same shape
as `client/src/app/agents/_components/AgentsListView/`:

- Header: title/subtitle, search input, **Add Skill** dropdown (`Button
  kind="primary" icon="Plus" iconRight="ChevronDown"`) with two entries:
  **Create** (opens a create modal, name/description/type/body form — same
  fields as `CreateAgentModal` minus provider/model) and **Import** (opens
  the import drawer, below).
- Grid: `repeat(auto-fill, minmax(280px, 1fr))`, one `SkillCard` per skill.
- Loading/empty/error via `Skeleton`/`EmptyState`/`ErrorState` (`@devdigest/ui`).
- Data: new `client/src/lib/hooks/skills.ts` (`useSkills`, `useCreateSkill`,
  `useUpdateSkill`, `useDeleteSkill`, `useImportSkillPreview`,
  `useConfirmSkillImport` — the last two hit the server spec's two distinct
  `/skills/import/preview` and `/skills/import` routes, never `useCreateSkill`),
  same query-key shape as `client/src/lib/hooks/agents.ts` (`["skills"]`,
  `["skill", id]`).

### `SkillCard`

New component, `client/src/app/skills/_components/SkillCard/` — **not** a
reuse of `AgentCard` (that component is `Agent`-typed and hand-styled per
feature, per existing repo precedent of one card component per entity).
Renders: icon, name, type chip, source badge
(`Manual`/`Imported`/`Extracted`/`Community` from `SkillSource`), a global
`enabled` `Toggle` (mutates via `useUpdateSkill`), description, delete
button (`window.confirm` + `useDeleteSkill`, same UX as `AgentCard`'s
delete).

## Skill editor

`client/src/app/skills/[id]/page.tsx` + `_components/SkillEditor/` — two-pane
layout copied from `agents/[id]/page.tsx` (280px skill-list rail using
`SkillCard` with `active`, editor pane on the right with name/type/badges in
the header bar).

Tabs, scope confirmed: **Config + Preview + Versions only** — Evals/Stats/CI
seen in the design mockups are deferred (no scoring logic exists for
`eval_cases`/`eval_runs` anywhere in the codebase, and Stats' accept-rate has
no backing data source on `findings`; building either is a separate,
materially larger feature).

- **Config** — mirrors `AgentEditor/_components/ConfigTab/ConfigTab.tsx`
  exactly: local `useState` per field seeded from the skill, reset on
  `skill.id` change, `FormField` + `TextInput` (name) + `Textarea`
  (description — label explicitly frames it as *"the skill's interface, write
  it directively"*, per the product requirement that description doubles as
  the skill's contract) + `SelectInput` (type) + `Textarea mono` (body,
  markdown — no rich editor exists in this repo, `Textarea` is the
  established precedent for `system_prompt` too), Save button →
  `useUpdateSkill`, toast + inline "Saved (vN)" note.
- **Preview** — renders `body` through the existing `Markdown` primitive
  (`client/src/vendor/ui/primitives/Markdown.tsx`, already used elsewhere,
  wraps `react-markdown` + `remark-gfm`). Read-only, "rendered as the
  reviewing agent receives it" framing per the design mockup.
- **Versions** — list `skill_versions` (newest first) via a new
  `useSkillVersions(id)` hook, each row showing version number + timestamp +
  Diff/Restore actions. No existing Agents-versions-tab UI to copy verbatim
  (Agents ships Config only today) — build directly against
  `GET /skills/:id/versions[/:version]`.

## Agent editor: Skills tab (the one new interaction)

`client/src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/` —
new.

- `AgentEditor/constants.ts` — extend `TABS` with
  `{ key: "skills", labelKey: "editor.tabs.skills", icon: "Sparkles" }`
  (i18n key already present in `agents.json`). `AgentEditor.tsx` needs actual
  tab-switch rendering added (today it unconditionally mounts `ConfigTab`
  regardless of `tab` — there is no branching yet).
- List **all** workspace skills (`useSkills()`), cross-referenced against this
  agent's linked set (`GET /agents/:id/skills` — existing endpoint,
  unchanged). Each row: drag handle, checkbox (checked = linked to this
  agent), name, type/source badges. Unchecked rows still render (dimmed,
  no drag) so the list always shows "N of M enabled" per the existing
  `skills.enabledCount` copy.
- Checking/unchecking or reordering recomputes the ordered array of checked
  skill ids and calls the existing `POST /agents/:id/skills` with
  `{ skill_ids }` — the bulk-replace shape `AgentsRepository.setSkills`
  already implements (delete-all, reinsert with `order = index`). No new
  endpoint.
- Drag-and-drop: **no DnD library exists in this repo** (checked
  `package.json` and all of `src` — no `dnd-kit`, `react-beautiful-dnd`,
  etc.). Add `@dnd-kit/core` + `@dnd-kit/sortable` (React-19-safe). Add a
  `GripVertical` icon to `client/src/vendor/ui/icons.tsx`'s hand-picked
  allow-list (not currently exported).
- Wire up `AgentCard`'s already-existing-but-unused `skillCount?` prop from
  the linked-skills count, in both `AgentsListView` and `agents/[id]/page.tsx`.

## Import drawer

Reuses the already-seeded `drawer.tabs` shell (a side drawer, not a modal —
matching `skills.json`'s `drawer.*` copy) rather than inventing a new
container. Of its three anticipated tabs, only **File** ships in this
feature:

- **File** — repurposed from the seeded "paste content" design into a real
  upload, because the written product requirement is explicitly "upload a
  markdown file **or archive**" with a preview before saving, not paste-a-body.
  Internally uses `ExportWizardSteps` (`client/src/vendor/ui/ExportWizardSteps.tsx`,
  currently demoed but unused by any real page) for three sub-steps:
  1. **Upload** — file picker accepting `.md`/`.txt`/`.zip`. No file-upload UI
     exists anywhere in this client today (no `type="file"` inputs, no
     drag/drop handlers found) — this is new UI, not a reuse.
  2. **Preview** — calls `POST /skills/import/preview` (server spec), shows
     the suggested name/description/type/body, and — for a `.zip` — an
     explicit list of ignored entries labeled "not processed, not executed"
     (the product requirement's "executable parts of the archive are not
     processed" made visible in the UI, not just true server-side).
  3. **Confirm** — edits allowed on the previewed fields; submit calls
     `POST /skills/import` (server spec's dedicated confirm-import route, not
     `useCreateSkill()` — keeps the plain create path from ever accepting a
     non-`manual` `source`). The server always creates the row `enabled: false`;
     the confirm screen's success state reuses the seeded copy verbatim
     (`url.success: "Imported \"{name}\". Disabled until you vet + enable it."`,
     adapted from "URL" to "file") and links back to the skill's card so the
     user can review the body and flip the `enabled` toggle once satisfied.
- **URL** and **Community** tabs (`drawer.tabs.url`/`.community`, the
  server-side-fetch and catalog-search flows their copy already describes)
  are **out of scope for this feature**, same as the plan's existing
  Community deferral — neither is in the written requirements (which only
  ask for file/archive upload), and a URL-fetch importer needs its own
  server-side fetch/SSRF-safety design this spec doesn't cover. Leave their
  drawer tab entries out of the rendered UI rather than shipping dead tabs;
  the `skills.json` keys can stay unused until that work is picked up.

Trust framing: the drawer's copy states plainly that an imported skill's body
becomes part of the agent's prompt and stays **disabled until manually
vetted** (mirrors the requirement that "someone else's skill is someone
else's instructions in the agent's prompt" — made visible in-product, not
just in the code comment already present in `reviewer-core/src/prompt.ts`).

## Trace: skills block token count

`RunTraceDrawer/_components/TraceBody/TraceBody.tsx` already renders a
distinct `PromptBlock` for `trace.prompt_assembly.skills` (conditional on
non-null, own accent color) — **no new block needed**. Add a small token-count
badge next to that block's label once `trace.prompt_assembly.token_counts?.skills`
is populated (server spec) — same file, same section, one new conditional
render.

## Nav

`client/src/vendor/ui/nav.ts` — add a `skills` entry to `NAV` (the app-shell
already special-cases the `/skills` active-key match; there's currently
nothing to route to).

## i18n

`client/messages/en/skills.json` already has substantially-worked-out copy
(list/create subtitles, editor tab labels, `skills.enabledCount`/`orderHint`,
and the full drawer/vetting copy discussed above) — reuse what applies,
repurpose the "From file" tab's copy for real upload instead of paste, and
leave the `url`/`community` tab keys unused (not deleted — a future lesson
may pick them up) rather than writing new ones that duplicate them. Extend
only where genuinely missing (e.g. archive-specific "ignored entries" list
copy, which the seeded paste-based design never needed).

## e2e coverage

`e2e/` is this repo's deterministic browser suite for real user journeys
(component tests intentionally don't hit a real API/browser, per
`client/CLAUDE.md`). Existing flows are numbered `e2e/specs/01`–`07`; add the
next one (`08-skills.flow.json` or equivalent, check `e2e/CLAUDE.md` for the
exact convention) covering: create a skill → attach it to an agent via the
Skills tab → drag-reorder → run a review with it enabled vs. unlinked → open
the run trace and confirm the Skills block appears only when linked. This is
exactly the kind of cross-page journey this suite exists for, not just
`*.test.tsx` component coverage.

The two controlled-experiment fixture PRs (happy-path-only test PR;
route-signature-change PR — see the plan's "Controlled experiment" section)
should be seeded the same way as the existing demo PR
(`acme/payments-api` #482, `server/src/db/seed.ts`) rather than created ad
hoc during manual testing only, so both the e2e flow above and a human
re-running the experiment later hit the same fixtures. See
`server/specs/skills.md`'s "Reproducibility" section.

## Contract change

Hand-mirror `server/src/vendor/shared/contracts/trace.ts`'s
`PromptAssembly.token_counts` addition into
`client/src/vendor/shared/contracts/trace.ts` — no sync tooling exists
between the two vendor copies (`client/insights.md`/`server/insights.md`,
Open Questions).

## Explicitly not doing

- Evals tab, Stats tab, CI tab on the Skill editor.
- Community skill catalog/browsing (`CommunitySkill` contract exists in
  `knowledge.ts`, unused) and URL-fetch import (`drawer.tabs.url`) — both
  anticipated by the seeded i18n copy but out of scope: not in the written
  requirements, and URL-fetch needs its own SSRF-safety design. Only local
  file/archive import is in scope.
- A generic reusable "card grid" or "two-pane list+detail" primitive — the
  Agents feature doesn't have one either (each page hand-rolls its layout);
  following that existing precedent rather than introducing an abstraction
  this codebase doesn't otherwise use.
- Reusing `AgentCard` for skills (type mismatch; a parallel `SkillCard` is
  simpler than generalizing an existing, already-narrow component).
