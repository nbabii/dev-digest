// Name -> id resolution over the list endpoints. Application layer: port + errors only.
import { McpToolError } from '../errors.js';
import type { Agent, DevDigestApi, Repo } from '../ports.js';

const REPO_TTL_MS = 60_000;
const MAX_KNOWN = 5;

export interface Resolver {
  repo(name: string): Promise<Repo>;
  pull(repoId: string, number: number): Promise<string>;
  agent(idOrName: string): Promise<Agent>;
}

export function createResolver(api: DevDigestApi, opts: { now?: () => number } = {}): Resolver {
  const now = opts.now ?? Date.now;
  let repoCache: { at: number; repos: Repo[] } | undefined;
  const prIds = new Map<string, string>();

  async function repos(): Promise<Repo[]> {
    if (repoCache && now() - repoCache.at < REPO_TTL_MS) return repoCache.repos;
    const list = await api.listRepos();
    repoCache = { at: now(), repos: list };
    return list;
  }

  const known = (list: readonly { full_name: string }[]): string =>
    list.length === 0
      ? 'no repositories are imported'
      : `known repos: ${list
          .slice(0, MAX_KNOWN)
          .map((r) => r.full_name)
          .join(', ')}${list.length > MAX_KNOWN ? `, ... (${list.length} total)` : ''}`;

  return {
    async repo(name) {
      const list = await repos();
      const parts = name.split('/');
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new McpToolError(
          `Invalid repo "${name}", expected "owner/name"`,
          `retry with one of the ${known(list)}`,
        );
      }
      const want = name.toLowerCase();
      const hit = list.find((r) => r.full_name.toLowerCase() === want);
      if (!hit) {
        throw new McpToolError(
          `Repo "${name}" is not imported in DevDigest (${known(list)})`,
          'retry with one of the known repos, or import the repo in the DevDigest UI first',
        );
      }
      return hit;
    },

    async pull(repoId, number) {
      const key = `${repoId}:${number}`;
      const cached = prIds.get(key);
      if (cached) return cached;
      const pulls = await api.listPulls(repoId);
      const hit = pulls.find((p) => p.number === number && !!p.id);
      if (!hit?.id) {
        const nums = pulls
          .filter((p) => !!p.id)
          .map((p) => p.number)
          .slice(0, 10);
        throw new McpToolError(
          `PR #${number} not found for this repo (API lists ${nums.length ? `#${nums.join(', #')}` : 'no PRs'})`,
          'retry with a PR number the API lists; new PRs appear after the repo syncs from GitHub',
        );
      }
      prIds.set(key, hit.id);
      return hit.id;
    },

    async agent(idOrName) {
      const agents = await api.listAgents();
      const byId = agents.find((a) => a.id === idOrName);
      let hit = byId;
      if (!hit) {
        const want = idOrName.toLowerCase();
        const named = agents.filter((a) => a.name.toLowerCase() === want);
        if (named.length === 0) {
          throw new McpToolError(`Agent "${idOrName}" not found`, 'call list_agents and pass an id or exact name from it');
        }
        if (named.length > 1) {
          throw new McpToolError(`${named.length} agents named "${idOrName}"`, 'pass the id from list_agents');
        }
        hit = named[0];
      }
      if (!hit) throw new McpToolError(`Agent "${idOrName}" not found`, 'call list_agents');
      if (!hit.enabled) {
        throw new McpToolError(
          `Agent "${hit.name}" is disabled`,
          'enable it in the DevDigest UI, or call list_agents and pick an enabled agent',
        );
      }
      return hit;
    },
  };
}
