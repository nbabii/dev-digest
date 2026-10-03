/**
 * blast repository — the three lookups the read-only blast report needs.
 * Own queries only (no import from `modules/reviews/repository`); returns
 * purpose-shaped objects, not Drizzle `$inferSelect` rows.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export interface BlastPull {
  id: string;
  repoId: string;
  number: number;
  /** Base branch name (the schema stores no base sha). */
  base: string;
  headSha: string;
}

export interface BlastRepoBasics {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
}

export interface ChangedFilePatch {
  path: string;
  patch: string | null;
}

/** Port the service depends on (lets tests inject a fake without a DB). */
export interface BlastStore {
  getPull(workspaceId: string, prId: string): Promise<BlastPull | null>;
  getRepoBasics(repoId: string): Promise<BlastRepoBasics | null>;
  getChangedFiles(prId: string): Promise<ChangedFilePatch[]>;
}

export class BlastRepository implements BlastStore {
  constructor(private db: Db) {}

  /** Workspace-scoped: this is the tenancy gate (repo-intel tables have no workspace_id). */
  async getPull(workspaceId: string, prId: string): Promise<BlastPull | null> {
    const [row] = await this.db
      .select({
        id: t.pullRequests.id,
        repoId: t.pullRequests.repoId,
        number: t.pullRequests.number,
        base: t.pullRequests.base,
        headSha: t.pullRequests.headSha,
      })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row ?? null;
  }

  async getRepoBasics(repoId: string): Promise<BlastRepoBasics | null> {
    const [row] = await this.db
      .select({
        owner: t.repos.owner,
        name: t.repos.name,
        fullName: t.repos.fullName,
        defaultBranch: t.repos.defaultBranch,
      })
      .from(t.repos)
      .where(eq(t.repos.id, repoId));
    return row ?? null;
  }

  async getChangedFiles(prId: string): Promise<ChangedFilePatch[]> {
    return this.db
      .select({ path: t.prFiles.path, patch: t.prFiles.patch })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId));
  }
}
