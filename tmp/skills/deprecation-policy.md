name: deprecation-policy
description: Require a deprecation period — marked, warned, still working — before a public function, field, or route is deleted; flag a silent removal.
type: convention

# Deprecation policy

Removing something from a public contract in the same diff that stops
supporting it is a silent removal — the safe path is a two-step process:
mark it deprecated and keep it working for at least one release, *then*
delete it in a later diff. On any diff that removes a function, export,
route, or field, check:

- Is this the deletion of something that was never marked deprecated first?
  That's the pattern to flag — going straight from "supported" to "gone" in
  one diff.
- If something *is* being marked deprecated in this diff, does it still
  work for existing callers (not a stub that throws), and is there a
  visible signal (JSDoc `@deprecated`, a runtime warning log, a docs note)
  telling callers to migrate?
- A deprecated item being deleted in *this* diff is fine only if there's
  evidence it already went through a deprecation window (e.g. a changelog
  entry, a prior commit marking it deprecated, or an explicit major-version
  removal note) — don't assume; look for it in the diff/PR description.

## Good — flagged correctly

```diff
-export async function getUserByEmail(email: string): Promise<User | null> {
-  return db.query.users.findFirst({ where: eq(users.email, email) });
-}
+// removed — use getUserById instead
```

`getUserByEmail` is deleted outright with no prior deprecation marker
anywhere in history and no migration path left behind for callers still
importing it — any caller not touched in this diff breaks immediately.
**CRITICAL** if a caller in this repo still imports `getUserByEmail`;
**WARNING** if none do, but it's exported from a package other repos may
consume. The fix isn't necessarily "don't remove it" — it's "mark it
deprecated first, remove it in a later diff."

## Bad — false positive, do not flag

```diff
+/** @deprecated Use `getUserById` instead. Will be removed in v4.0. */
 export async function getUserByEmail(email: string): Promise<User | null> {
   return db.query.users.findFirst({ where: eq(users.email, email) });
 }
```

The function still works exactly as before, existing callers are
unaffected, and it's now clearly marked with a migration target and a
removal version. This is the deprecation step done correctly — don't flag
it as if the function were being removed; it isn't.
