name: response-schema
description: Flag changes to a response's shape — field types, optionality, or removed/renamed fields — that consumers deserializing the old shape aren't updated for.
type: convention

# Response schema

A response body is a contract with every consumer that deserializes it, not
just the one caller shown in the diff. On any diff that touches a route
handler's return value or a shared response type, check:

- A field is removed or renamed — old consumers reading it get `undefined`
  instead of a clear failure.
- A field's type narrows or changes shape (`string` → `string | null` going
  the wrong way, `number` → `string`, a flat field → a nested object).
- A field that was always present becomes conditionally omitted (e.g. only
  included when a feature flag is on) without consumers being told.
- An array element's shape changes for existing items, not just new ones.

Not breaking, and should not be flagged: adding a new optional field, adding
a new value to an already-open string/enum the client is expected to
ignore-unknown on, or widening a field's type in a way that's still valid
for every existing consumer (`string` → `string | null` when consumers
already handle `null` for other fields of that response).

## Good — flagged correctly

```diff
 // GET /payments/:id
 {
   id: string,
   amount: number,
-  status: 'pending' | 'settled' | 'failed',
+  status: 'pending' | 'settled' | 'failed' | 'refunded',
-  createdAt: string,   // ISO 8601
+  createdAt: number,   // unix epoch ms
 }
```

`createdAt` changes type from an ISO string to a epoch number for a field
every existing consumer already parses as a date string — `new Date(createdAt)`
on the old shape silently produces `Invalid Date` instead of throwing.
**CRITICAL**: this is a type change on an existing field, not an addition —
flag it even though the diff also adds a harmless new `'refunded'` status
value (that part is fine on its own and shouldn't be called out).

## Bad — false positive, do not flag

```diff
 // GET /payments/:id
 {
   id: string,
   amount: number,
   status: 'pending' | 'settled' | 'failed',
   createdAt: string,
+  refundedAt: string | null,
 }
```

Purely additive: a new nullable field that didn't exist before. Existing
consumers that don't know about `refundedAt` are unaffected — they simply
don't read it. Do not flag new fields just because "the schema changed"; the
question is whether an existing field's presence, name, or type changed for
callers that already depend on it.
