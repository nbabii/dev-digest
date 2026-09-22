/* hooks/conventions.ts — React Query hooks for the Conventions Extractor.
   Mirrors hooks/repo-intel.ts's poll-flag shape (see useRepoIntelStatus):
   the caller passes `poll` and owns when to stop polling once the scan
   reaches a terminal status. See server/specs/conventions-extractor.md. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ConventionCandidate, ConventionScan } from "@devdigest/shared";

export interface ConventionsResponse {
  scan: ConventionScan | null;
  candidates: ConventionCandidate[];
}

/** GET /repos/:id/conventions — the latest scan only, plus its candidates. */
export function useConventions(repoId: string | null | undefined, poll: boolean) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionsResponse>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
    refetchInterval: poll ? 2000 : false,
  });
}

/** POST /repos/:id/conventions/extract — 202, starts a background scan. */
export function useRunExtraction(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ status: string; jobId?: string }>(`/repos/${repoId}/conventions/extract`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}

export interface UpdateConventionInput {
  id: string;
  repoId: string;
  patch: Partial<Pick<ConventionCandidate, "status" | "rule" | "category">>;
}

/** PATCH /conventions/:id — accept/reject/edit one candidate, optimistic. */
export function useUpdateConvention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateConventionInput) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, patch),
    onMutate: async ({ id, repoId, patch }) => {
      const key = ["conventions", repoId];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ConventionsResponse>(key);
      if (previous) {
        qc.setQueryData<ConventionsResponse>(key, {
          ...previous,
          candidates: previous.candidates.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        });
      }
      return { previous, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(ctx.key, ctx.previous);
    },
    onSettled: (_data, _err, { repoId }) => qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}
