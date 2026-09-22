# Onion Architecture — Worked Examples

Concrete, repo-grounded examples for the rules in [SKILL.md](SKILL.md).

## 1. A Real Leak: `ReviewRepository` Returning Raw Drizzle Types

`server/src/modules/reviews/repository.ts` today:

```typescript
// repository.ts
export type { FindingRow, PullRow } from '../../db/rows.js'; // = typeof t.*.$inferSelect

export class ReviewRepository {
  constructor(private db: Db) {}

  getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    return pullRepo.getPull(this.db, workspaceId, prId);
  }

  getRepo(repoId: string): Promise<typeof t.repos.$inferSelect | undefined> {
    return pullRepo.getRepo(this.db, repoId);
  }
}
```

`$inferSelect` is Drizzle's column-for-column row shape — an
**infrastructure** type. Because `getRepo()`'s return type is inferred
straight from the table schema, every caller in `service.ts` (an
application-ring file) now has a compile-time dependency on the exact shape
of the `repos` table. Add a column, drop a column, rename `full_name` — and
every service that touches `.getRepo()` may need to change, even though the
use case ("look up the repo for this PR") never changed.

**The fix shape** (apply to *new* repository methods; existing ones don't
need an emergency rewrite):

```typescript
// repository.ts
export interface RepoSummary {
  id: string;
  fullName: string;
  defaultBranch: string;
}

export class ReviewRepository {
  async getRepo(repoId: string): Promise<RepoSummary | undefined> {
    const row = await pullRepo.getRepo(this.db, repoId);
    if (!row) return undefined;
    return { id: row.id, fullName: row.fullName, defaultBranch: row.defaultBranch };
  }
}
```

Now `service.ts` depends on `RepoSummary` — a shape the *application* ring
owns — not on whatever `repos` happens to look like in Postgres this week.
This is the same DTO-mapping move `helpers.ts`'s `reviewToDto`/
`findingRowToDto` already do for reviews/findings — apply it consistently
at every repository boundary, not just the ones that already got it.

## 2. Wiring a New Port End-to-End

Say a module needs to post a Slack notification. Walking the ring from
inside out:

**Step 1 — define the port** (`server/src/vendor/shared/adapters.ts`, next
to `LLMProvider`/`GitHubClient`):

```typescript
export interface NotificationSender {
  send(channel: string, message: string): Promise<void>;
}
```

**Step 2 — implement it in infrastructure** (`server/src/adapters/notify/slack.ts`):

```typescript
import type { NotificationSender } from '@devdigest/shared';

export class SlackNotifier implements NotificationSender {
  constructor(private webhookUrl: string) {}
  async send(channel: string, message: string): Promise<void> {
    await fetch(this.webhookUrl, { method: 'POST', body: JSON.stringify({ channel, text: message }) });
  }
}
```

**Step 3 — add a lazy getter on `Container`** (`server/src/platform/container.ts`,
same pattern as `codeIndex`/`git`):

```typescript
private _notifier?: NotificationSender;

get notifier(): NotificationSender {
  if (this.overrides.notifier) return this.overrides.notifier;
  this._notifier ??= new SlackNotifier(this.config.slackWebhookUrl);
  return this._notifier;
}
```

Also add `notifier?: NotificationSender` to `ContainerOverrides` so tests
can inject a mock the same way they already do for `git`/`codeIndex`.

**Step 4 — consume it from the service, never the concrete class**:

```typescript
// modules/reviews/service.ts — correct
constructor(private container: Container) {
  this.notifier = container.notifier; // depends on the interface via Container
}

// modules/reviews/service.ts — WRONG, skips the port
import { SlackNotifier } from '../../adapters/notify/slack.js'; // ✗ inward ring importing outward
```

The service never knows Slack exists — swap `SlackNotifier` for a
`DiscordNotifier` later and nothing in `service.ts` changes, exactly like
swapping `OpenAIProvider` for `AnthropicProvider` behind `LLMProvider`
today.

## 3. Enforcing the Dependency Rule with `dependency-cruiser`

`dependency-cruiser` is already installed in `server/` (currently used only
as a library for repo-intel's import-graph analysis of *other* repos). A
`.dependency-cruiser.cjs` at `server/` root turns the rules in
[SKILL.md](SKILL.md) into something `pnpm dlx depcruise` can fail on in CI:

```javascript
// server/.dependency-cruiser.cjs
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-service-to-adapter',
      comment:
        'Application services must depend on ports (adapters.ts interfaces via Container), never on concrete adapters directly.',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/service\\.ts$' },
      to: { path: '^src/adapters' },
    },
    {
      name: 'no-drizzle-outside-persistence',
      comment:
        'Only src/adapters and src/db may talk to drizzle-orm directly — keep the ORM out of the application/delivery rings.',
      severity: 'error',
      from: { pathNot: '^src/(adapters|db)' },
      to: { path: 'node_modules/drizzle-orm' },
    },
    {
      name: 'reviewer-core-stays-pure',
      comment: 'reviewer-core must never depend on server/, Fastify, or Drizzle.',
      severity: 'error',
      from: { path: '^src' },
      to: { path: 'node_modules/(fastify|drizzle-orm)' },
      // run this variant with `from.path` scoped to reviewer-core/src when
      // wiring the config there; server/ itself legitimately depends on both.
    },
  ],
  options: { tsPreCompilationDeps: true, tsConfig: { fileName: 'tsconfig.json' } },
};
```

Start with just the first two rules in `server/` (the third needs its own
config scoped to `reviewer-core/`, since `server/` is expected to depend on
Fastify/Drizzle). Run `npx depcruise src --config .dependency-cruiser.cjs`
locally before wiring it into CI, since the existing codebase (per Rule 1
above) will surface real violations on the first run — triage those as a
separate cleanup pass rather than blocking on all of them at once.
