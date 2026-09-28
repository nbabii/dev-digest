/* hooks/intent.ts — React Query hooks for the Intent Layer (see
   docs/plans/intent-layer.md). Mirrors hooks/conventions.ts's shape, but
   unlike Conventions' background scan, classification is synchronous
   (request/response) — no `poll`/`refetchInterval` flag here. Not added to
   hooks/index.ts's barrel, matching that file's own precedent of importing
   conventions.ts/skills.ts directly. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Intent } from "@devdigest/shared";

/** GET /pulls/:id/intent — classifies on first call, cached/staleness-checked server-side after. */
export function useIntent(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["intent", prId],
    queryFn: () => api.get<Intent>(`/pulls/${prId}/intent`),
    enabled: !!prId,
  });
}

/** POST /pulls/:id/intent/reclassify — always re-runs, ignoring staleness. */
export function useReclassifyIntent(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Intent>(`/pulls/${prId}/intent/reclassify`, {}),
    onSuccess: (data) => qc.setQueryData(["intent", prId], data),
  });
}
