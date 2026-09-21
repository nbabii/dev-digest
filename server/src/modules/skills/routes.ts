import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import multipart from '@fastify/multipart';
import { SkillType } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams, VersionParams } from '../_shared/schemas.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { SkillsService } from './service.js';
import { buildImportPreview, IMPORT_LIMITS } from './import-parser.js';
import { buildUrlImportPreview } from './url-import.js';

/**
 * Skills module — entity CRUD + import. Mirrors `modules/agents/routes.ts`.
 *
 *   GET    /skills                       list (workspace-scoped)
 *   GET    /skills/:id                   one skill
 *   POST   /skills                       create (source ALWAYS forced 'manual')
 *   PUT    /skills/:id                   update / toggle enabled (versions on body change)
 *   DELETE /skills/:id                   delete (cascades agent_skills via FK)
 *   GET    /skills/:id/versions          history, newest first
 *   GET    /skills/:id/versions/:version one snapshot
 *   POST   /skills/import/preview        parse an uploaded file/archive -> suggested fields, NOT persisted
 *   POST   /skills/import/url-preview    fetch a https:// URL -> suggested fields, NOT persisted (see skill-url-import.md)
 *   POST   /skills/import                confirm-create from a previewed payload (source+enabled server-forced)
 */

const CreateSkillBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: SkillType,
  body: z.string().min(1),
  enabled: z.boolean().optional(),
  // Deliberately NO `source` field: POST /skills always persists 'manual' —
  // see SkillsService.create. Any `source` a client sends here is ignored by
  // Zod's default strip-unknown-keys behavior before it ever reaches the service.
});

const UpdateSkillBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: SkillType.optional(),
  body: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  // `source` is immutable after creation — not accepted here either.
});

/**
 * Only these two sources are reachable through the import route — 'manual'
 * (plain create's job) and 'community' (no catalog import exists yet) are
 * excluded by this enum, not just by convention. This is the actual
 * enforcement point for the Trust model's "no way to reach imported_url /
 * extracted through POST /skills, and no way to reach manual / community
 * through POST /skills/import" rule.
 */
const ImportSource = z.enum(['imported_url', 'extracted']);

const UrlPreviewBody = z.object({
  url: z.string().url(),
});

const ConfirmImportBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: SkillType,
  body: z.string().min(1),
  source: ImportSource,
  evidence_files: z.array(z.string()).optional(),
  // Deliberately NO `enabled` field: POST /skills/import always forces
  // enabled:false on creation — see SkillsService.confirmImport.
});

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  // Registered only in this module's own encapsulation context (Fastify
  // plugins are encapsulated by default) — nothing outside modules/skills
  // gains multipart parsing. `fileSize`/`files` mirror IMPORT_LIMITS.
  await app.register(multipart, {
    limits: { fileSize: IMPORT_LIMITS.MAX_UPLOAD_BYTES, files: 1 },
  });

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.create(workspaceId, req.body);
    reply.status(201);
    return skill;
  });

  app.put(
    '/skills/:id',
    { schema: { params: IdParams, body: UpdateSkillBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.update(workspaceId, req.params.id, req.body);
      if (!skill) throw new NotFoundError('Skill not found');
      return skill;
    },
  );

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Skill not found');
    return { ok: true };
  });

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const versions = await service.listVersions(workspaceId, req.params.id);
    if (!versions) throw new NotFoundError('Skill not found');
    return versions;
  });

  app.get(
    '/skills/:id/versions/:version',
    { schema: { params: VersionParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const version = await service.getVersion(workspaceId, req.params.id, req.params.version);
      if (!version) throw new NotFoundError('Skill version not found');
      return version;
    },
  );

  // ---- Import: preview (parse only) + confirm (persist) -------------------

  app.post(
    '/skills/import/preview',
    // Per-route override of the app-wide 1MB bodyLimit (see app.ts) — allow
    // exactly the upload cap plus a small margin for multipart framing.
    { bodyLimit: IMPORT_LIMITS.MAX_UPLOAD_BYTES + 65_536 },
    async (req) => {
      await getContext(app.container, req); // tenancy check, even though nothing is scoped by it yet
      const file = await req.file();
      if (!file) {
        throw new ValidationError('No file uploaded — expected multipart/form-data with one file part');
      }
      const buffer = await file.toBuffer();
      if (file.file.truncated) {
        throw new ValidationError(
          `Upload exceeds the size limit (${IMPORT_LIMITS.MAX_UPLOAD_BYTES} bytes)`,
        );
      }
      return buildImportPreview(file.filename, buffer);
    },
  );

  app.post(
    '/skills/import/url-preview',
    { schema: { body: UrlPreviewBody } },
    async (req) => {
      await getContext(app.container, req); // tenancy check, same as the file-preview route above
      return buildUrlImportPreview(req.body.url);
    },
  );

  app.post('/skills/import', { schema: { body: ConfirmImportBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.confirmImport(workspaceId, req.body);
    reply.status(201);
    return skill;
  });
}
