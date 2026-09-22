/* Small local relative-time formatter — same three-branch shape as
   repos/[repoId]/pulls/helpers.ts's `relativeTime`, duplicated rather than
   imported cross-feature (matches this codebase's existing precedent of
   small helpers living next to their one caller, e.g. repo-intel/service.ts's
   several un-exported `readClone` copies). */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const m = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
