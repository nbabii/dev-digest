/* hooks/blast-radius.ts — React Query hooks for the PR Blast Radius card
   (docs/plans/blast-radius.md). Not in the hooks/index.ts barrel, same
   precedent as hooks/intent.ts. */
"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useResyncRepoIntel } from "./repo-intel";
import type { BlastRadiusReport } from "@devdigest/shared";

const STALE_MS = 30_000;
const INDEXING_POLL_MS = 3000;

/** GET /pulls/:id/blast-radius — read-only map built from the persisted repo index.
    Polls only while the server reports an index job in flight; stops by itself. */
export function useBlastRadius(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["blast-radius", prId],
    queryFn: () => api.get<BlastRadiusReport>(`/pulls/${prId}/blast-radius`),
    enabled: !!prId,
    staleTime: STALE_MS,
    refetchInterval: (query) => (query.state.data?.index.indexing ? INDEXING_POLL_MS : false),
  });
}

/** User-initiated "Re-analyze": reuses POST /repos/:id/resync, then refetches the
    report so polling can pick up `index.indexing`. */
export function useReanalyzeBlast(repoId: string | null | undefined, prId: string | null | undefined) {
  const qc = useQueryClient();
  const resync = useResyncRepoIntel(repoId);
  return {
    isPending: resync.isPending,
    mutate: () =>
      resync.mutate(undefined, {
        onSuccess: () => qc.invalidateQueries({ queryKey: ["blast-radius", prId] }),
      }),
  };
}
