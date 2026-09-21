import { describe, it, expect, vi } from 'vitest';
import { JobRunner } from '../src/platform/jobs.js';
import type { Db } from '../src/db/client.js';

/** Minimal fake satisfying only the two Drizzle chains JobRunner touches. */
function fakeDb(): Db {
  return {
    insert: () => ({ values: () => ({ returning: async () => [{ id: 'job-1' }] }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  } as unknown as Db;
}

describe('JobRunner.enqueue', () => {
  it('never surfaces a failing job as an unhandled promise rejection', async () => {
    const runner = new JobRunner(fakeDb(), { retries: 0, timeoutMs: 0 });
    runner.register('boom', async () => {
      throw new Error('boom');
    });

    const onUnhandled = vi.fn();
    process.on('unhandledRejection', onUnhandled);

    try {
      // Fire-and-forget, exactly like repos/service.ts, repo-intel/routes.ts,
      // and conventions/routes.ts do — none of them await/catch `job.done`.
      await runner.enqueue('ws-1', 'boom', {});
      await runner.onIdle();
      // Let the microtask queue settle so a real unhandled rejection would surface.
      await new Promise((r) => setTimeout(r, 0));

      expect(onUnhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
