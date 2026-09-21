name: semver-discipline
description: Require a major version bump for any change that breaks an existing consumer; flag a breaking change shipped as a minor/patch or with no version change at all.
type: convention

# Semver discipline

When a diff touches a versioned package (`package.json`) or a versioned API
route (e.g. `/v1/...`), check the version change against the actual size of
the contract change — not just whether a version was bumped at all:

- A breaking change (see the `breaking-change` and `response-schema` skills
  for what counts) must ship with a **major** bump — `1.4.2` → `2.0.0`, or a
  new route version (`/v1/orders` stays, `/v2/orders` is added).
- A purely additive, backward-compatible change only needs a **minor** bump;
  a pure bug fix with no contract change only needs a **patch** bump. Don't
  flag a breaking change for using a minor bump when the change genuinely
  isn't breaking — this skill exists to catch mismatches, not to demand
  major bumps by default.
- No version change at all alongside a breaking change is the same problem
  as an under-bump — flag it the same way.

## Good — flagged correctly

```diff
 // package.json
-  "version": "3.2.0",
+  "version": "3.2.1",

 // src/client.ts
-export function fetchOrders(cursor: string): Promise<Order[]> {
+export function fetchOrders(cursor: string, opts: { pageSize: number }): Promise<Order[]> {
```

`opts` is added with no default and no overload, so every existing call
site (`fetchOrders(cursor)`) now fails to compile / gets `opts` as
`undefined` at runtime. This is a breaking signature change shipped as a
**patch** bump. **CRITICAL** — either make `opts` optional with a default
(then a minor bump is correct and this stops being a finding), or bump to
`4.0.0`.

## Bad — false positive, do not flag

```diff
 // package.json
-  "version": "3.2.0",
+  "version": "3.3.0",

 // src/client.ts
 export function fetchOrders(cursor: string, opts?: { pageSize?: number }): Promise<Order[]> {
```

The new parameter is optional, existing calls are unaffected, and the bump
is minor — exactly right for an additive change. Do not flag "only a minor
bump" on its own; flag only when the bump *category* doesn't match the
actual contract impact of the change.
