name: breaking-change
description: Flag any removal or incompatible narrowing of a function's or route's public contract — never let a signature shrink silently.
type: convention

# Breaking change

Treat the **public surface** of a function, method, or route as a contract
with every caller outside this diff, not just the ones visible in it:

- A parameter is removed, reordered, or its type narrowed (e.g.
  `string | null` → `string`) in a way that rejects values old callers could
  legally pass.
- A route's path or HTTP method changes without the old one still routing
  (redirect, alias, or version-gated).
- A required field is added to a request payload that previously accepted it
  as optional or absent.
- An exported type, class, or function is renamed or deleted without a
  re-export/alias standing in for it.

A change is **not** breaking, and should not be flagged, when it's purely
additive and backward-compatible: a new optional parameter with a default, a
new optional response field, a new route, a widened accepted type (e.g.
`string` → `string | number`).

## Good — flagged correctly

```diff
-export async function getUserById(id: string, includeDeleted = false): Promise<User | null> {
-  return db.query.users.findFirst({
-    where: includeDeleted ? eq(users.id, id) : and(eq(users.id, id), eq(users.deleted, false)),
-  });
-}
+export async function getUserById(id: string): Promise<User | null> {
+  return db.query.users.findFirst({ where: eq(users.id, id) });
+}
```

`includeDeleted` is silently dropped. Any existing caller passing a second
argument (`getUserById(id, true)`) now gets a runtime type error or, worse,
a silently ignored argument — and the admin dashboard's "show deleted users"
path breaks with no compiler signal if it's untyped JS. **CRITICAL** if a
call site in this diff's repo still passes the second argument and isn't
updated in the same diff; **WARNING** otherwise (an external/unknown caller
may still rely on it).

## Bad — false positive, do not flag

```diff
-export async function getUserById(id: string): Promise<User | null> {
+export async function getUserById(id: string, opts: { includeDeleted?: boolean } = {}): Promise<User | null> {
+  const { includeDeleted = false } = opts;
   return db.query.users.findFirst({
-    where: eq(users.id, id),
+    where: includeDeleted ? eq(users.id, id) : and(eq(users.id, id), eq(users.deleted, false)),
   });
 }
```

Every existing call site (`getUserById(id)`) still compiles and behaves
identically — the new parameter is optional and additive. Do not raise a
finding just because a signature changed; raise one only when an existing,
valid call stops compiling or starts behaving differently.
