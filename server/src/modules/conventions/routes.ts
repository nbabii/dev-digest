/**
 * Conventions Extractor HTTP module — see server/specs/conventions-extractor.md.
 *
 *   POST  /repos/:id/conventions/extract  -> 202, enqueues CONVENTIONS_EXTRACT_JOB_KIND
 *   GET   /repos/:id/conventions          -> { scan, candidates } for the latest scan only
 *   PATCH /conventions/:id                -> accept/reject/edit one candidate
 *
 * Job-handler registration lives here (mirrors repoIntelRoutes' own
 * `service.registerIndexJobHandlers()` call at plugin load).
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ConventionCategory, ConventionStatus } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ConventionsService } from './service.js';
import { CONVENTIONS_EXTRACT_JOB_KIND } from './constants.js';

const UpdateConventionBody = z.object({
  status: ConventionStatus.optional(),
  rule: z.string().min(1).optional(),
  category: ConventionCategory.optional(),
});

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  const service = new ConventionsService(container);
  service.registerJobHandler();

  app.post(
    '/repos/:id/conventions/extract',
    { schema: { params: IdParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      if (await service.hasActiveScan(req.params.id)) {
        reply.code(202);
        return { status: 'accepted', alreadyRunning: true };
      }
      let jobId: string | null = null;
      try {
        const job = await container.jobs.enqueue(workspaceId, CONVENTIONS_EXTRACT_JOB_KIND, {
          repoId: req.params.id,
        });
        jobId = job.id;
      } catch {
        // swallow — degraded path, same as repo-intel's /resync
      }
      reply.code(202);
      return jobId
        ? { status: 'accepted', jobId }
        : { status: 'accepted', degraded: true, reason: 'no_handler' };
    },
  );

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    await getContext(container, req); // tenancy check, tenant-agnostic read below
    return service.listForRepo(req.params.id);
  });

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: UpdateConventionBody } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const candidate = await service.updateCandidate(workspaceId, req.params.id, req.body);
      if (!candidate) throw new NotFoundError('Convention candidate not found');
      return candidate;
    },
  );
}
