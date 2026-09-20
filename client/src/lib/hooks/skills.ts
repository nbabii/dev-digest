/* hooks/skills.ts — React Query hooks for the Skills area (list, editor,
   agent-editor Skills tab, import drawer). Mirrors hooks/agents.ts exactly. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Skill, SkillSource, SkillType } from "@devdigest/shared";

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => api.get<Skill[]>("/skills"),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", id],
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

export interface CreateSkillInput {
  name: string;
  description?: string;
  type: SkillType;
  body: string;
  enabled?: boolean;
}

/** Plain create (manual authoring). Server always forces `source: "manual"" —
    this is never used for imported content, see useConfirmSkillImport. */
export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: Partial<Pick<Skill, "name" | "description" | "type" | "body" | "enabled">>;
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.removeQueries({ queryKey: ["skill", id] });
    },
  });
}

/** One immutable `skill_versions` snapshot. */
export interface SkillVersion {
  skill_id: string;
  version: number;
  body: string;
  created_at: string;
}

/** History for a skill, newest first — `GET /skills/:id/versions`. */
export function useSkillVersions(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-versions", id],
    queryFn: () => api.get<SkillVersion[]>(`/skills/${id}/versions`),
    enabled: !!id,
  });
}

/** One snapshot — `GET /skills/:id/versions/:version` (used by Diff/Restore). */
export function useSkillVersion(id: string | null | undefined, version: number | null | undefined) {
  return useQuery({
    queryKey: ["skill-version", id, version],
    queryFn: () => api.get<SkillVersion>(`/skills/${id}/versions/${version}`),
    enabled: !!id && version != null,
  });
}

/** The non-manual sources a skill can carry when it comes through import. */
export type ImportedSkillSource = Extract<SkillSource, "imported_url" | "extracted">;

/** A zip entry the server parsed the name/size of but never read the body of —
    never executed, never processed past the central-directory listing. */
export interface IgnoredZipEntry {
  path: string;
  ignored: true;
}

/** Response of `POST /skills/import/preview` — a suggestion, not persisted. */
export interface SkillImportPreview {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  source: ImportedSkillSource;
  evidence_files: string[];
  /** Present (possibly empty) for a `.zip` upload — every entry that was not
      read as the body; omitted for a plain `.md`/`.txt` upload. */
  ignored?: IgnoredZipEntry[];
}

/** Upload a `.md`/`.txt`/`.zip` file for a preview — nothing is persisted yet. */
export function useImportSkillPreview() {
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.postForm<SkillImportPreview>("/skills/import/preview", form);
    },
  });
}

export interface ConfirmSkillImportInput {
  name: string;
  description?: string;
  type: SkillType;
  body: string;
  source: ImportedSkillSource;
  evidence_files?: string[];
}

/** Confirm-create from a (possibly user-edited) preview. The server — not the
    client — fixes `source` and always forces `enabled: false` on creation;
    this is the only path that can produce a non-"manual" skill row. Never
    use useCreateSkill for imported content — that route always forces
    source: "manual". */
export function useConfirmSkillImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConfirmSkillImportInput) => api.post<Skill>("/skills/import", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}
