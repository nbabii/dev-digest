/**
 * blast HTTP module.
 *
 *   GET /pulls/:id/blast-radius -> BlastRadiusReport
 *
 * Read-only, served purely from the repo-intel index in Postgres (no LLM, no
 * clone access beyond an optional `git diff`). Default rate limit only.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { BlastRadiusReport } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';

export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new BlastService(container);

  app.get(
    '/pulls/:id/blast-radius',
    { schema: { params: IdParams } },
    async (req): Promise<BlastRadiusReport> => {
      const { workspaceId } = await getContext(container, req);
      return service.getBlastRadius(workspaceId, req.params.id, req.log);
    },
  );
}
