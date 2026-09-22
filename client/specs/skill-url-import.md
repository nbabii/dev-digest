# Skill import — from URL (client)

Replaces `UrlPanel`'s "Not available yet" placeholder
(`client/src/app/skills/_components/SkillsListView/_components/AddSkillModal/_components/UrlPanel/UrlPanel.tsx`)
with a working 3-sub-step wizard — **structurally a copy of `FilePanel`**
(`.../_components/FilePanel/FilePanel.tsx`), not a new pattern. See
`server/specs/skill-url-import.md` for the API side.

## Why this mirrors FilePanel so closely

The provided mockup shows one screen — URL + Skill name + a single "Import
from URL" button — but the answered design decision is **preview-then-confirm**,
matching the existing File tab, not a single-step save. So the mockup's
fields get split across two of the wizard's three steps instead of one:

- **Step 1 ("url")** — URL input only (replaces FilePanel's "upload" step,
  which has just a file picker + Continue). No name field here — matches
  FilePanel's upload step having no editable fields either, everything
  editable lives in "confirm".
- **Step 2 ("preview")** — read-only rendering of what the server fetched +
  parsed (name/description/type/body), identical to FilePanel's preview step
  (`FilePanel.tsx:123-162`), minus the "ignored zip entries" section (not
  applicable — no archives, per the server spec's Decisions).
- **Step 3 ("confirm")** — the same editable Name/Description/Type/Body form
  as `FilePanel.tsx:164-194`, including the same untrusted-content notice
  (`preview.untrustedNotice`) and the same "Skill name" field/hint
  (`file.nameLabel`/`file.nameHint`) — this is where the mockup's "Skill
  name" field actually lands.

## Component

`UrlPanel.tsx` rewritten to the same state shape as `FilePanel.tsx`:

```ts
type ImportStep = "url" | "preview" | "confirm" | "done";
const STEP_INDEX: Record<Exclude<ImportStep, "done">, number> = { url: 0, preview: 1, confirm: 2 };
```

(New `constants.ts` for `UrlPanel`, parallel to `FilePanel/constants.ts` —
not shared, the two step-enums have different first-step names and
`FilePanel`'s also carries the `ACCEPT` file-extension constant, which
doesn't apply here.)

- **Step "url"**: a single `TextInput` bound to `url.placeholder`'s example
  shape, client-side validated as `https://` before enabling Continue (cheap
  UX guard — the server is the actual enforcement point per its spec, this
  is just "don't round-trip on an obviously-wrong value"). Calls the new
  `useImportUrlPreview()` hook on Continue, same trigger point as
  FilePanel's `runPreview`.
- **Step "preview"**: identical layout to `FilePanel`'s preview step, same
  `t("file.previewTitle")`/`t("file.descriptionLabel")`/etc. keys (reused,
  not duplicated — see i18n below).
- **Step "confirm"**: identical layout to `FilePanel`'s confirm step,
  calling the **existing** `useConfirmSkillImport()` unchanged — the exact
  same hook and route the file flow already uses, just with `source:
  'imported_url'` (which the server-side preview already fixed; the client
  just carries it through, same as `FilePanel.runConfirm` does today).
- **Step "done"**: identical to `FilePanel`'s done state (`url.success`
  copy — already seeded and, notably, already what `FilePanel.tsx:199`
  currently reuses for ITS OWN done state today; no change needed there).

## New hook: `useImportUrlPreview`

`client/src/lib/hooks/skills.ts`, parallel to `useImportSkillPreview`:

```ts
export function useImportUrlPreview() {
  return useMutation({
    mutationFn: (url: string) => api.post<SkillImportPreview>("/skills/import/url-preview", { url }),
  });
}
```

`SkillImportPreview` type (already defined in `hooks/skills.ts` for the file
flow) is reused as-is — same shape, `ignored` just never present on this
path.

## i18n

Reuse verbatim (all already seeded, all generic enough to not be
file-specific despite the `file.` prefix): `file.previewTitle`,
`file.descriptionLabel`, `file.typeLabel`, `file.bodyLabel`, `file.bodyHint`,
`file.confirmTitle`, `file.nameLabel`, `file.nameHint`, `file.back`,
`file.continue`, `file.viewSkill`, `preview.untrustedNotice`,
`drawer.importFailed`. Already-seeded URL-specific keys reused as designed:
`url.label`, `url.hint`, `url.placeholder`, `url.import`, `url.success`.

New keys needed (none of these existed — the seeded set only covered a
single-step flow's copy):

- `url.steps.url` / `url.steps.preview` / `url.steps.confirm` — wizard step
  labels, mirroring `file.steps.*`.
- `url.continue` — Step 1's Continue button while fetching (`file.continue`
  reused for its label; a fetching-in-progress variant is needed though,
  since `file.previewing`/`url.fetching` differ in wording and `url.fetching`
  is already seeded for exactly this — reuse `url.fetching`, not a new key).
- `url.fetchError` — inline error under the URL step when the preview call
  fails (protocol rejected, blocked host, timeout, too large, non-2xx,
  redirect refused, not valid text) — the server returns a distinct
  `ValidationError`/`ExternalServiceError` message per case
  (`server/specs/skill-url-import.md`), rendered as-is rather than mapped to
  five separate translated strings (matches `FilePanel`'s own
  `file.previewError` handling, which likewise appends the raw server
  message rather than special-casing failure types).

## Explicitly not doing

- No client-side host allowlist UI or "why was this blocked" explainer
  beyond the server's raw error message — matches the server spec's
  decision not to expose configuration for this.
- No `.zip`-over-URL affordance (no file-type hint, no archive-specific UI)
  — text/markdown only, per the server spec.
- No changes to `FilePanel.tsx` itself — this is a parallel implementation,
  not a shared abstraction. Following this codebase's own stated precedent
  (`server/specs/skills.md`'s "no generic reusable... primitive" note) of
  not introducing a shared wizard component across the two panels just
  because their step machinery looks alike; a genuinely identical
  step-indicator usage (`ExportWizardSteps`) is already the shared part.
- No e2e flow added in this pass — `client/specs/skills.md`'s existing
  Skills e2e coverage note didn't include URL import either; picking that
  up is a separate, later task.
