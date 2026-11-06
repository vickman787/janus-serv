import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { applicationRoutes } from '../../apps/api/src/routes.js';
import type { fixture } from '../recovery/fixture.js';
import { readyFixture, copilotService } from './support.js';

function harness(f: ReturnType<typeof fixture>, service: ReturnType<typeof copilotService>['service'], actor: string, bodyValue: unknown = {}) {
  let status = 0, value: unknown;
  const handler = applicationRoutes(
    f.engine,
    () => actor,
    () => actor,
    () => 'session',
    async () => bodyValue,
    (_res, nextStatus, nextValue) => { status = nextStatus; value = nextValue; },
    service,
  );
  return {
    async call(method: string, url: string) {
      await handler({ method, url } as IncomingMessage, {} as ServerResponse);
      return { status, value };
    },
  };
}

describe('authenticated copilot routes', () => {
  it('queues and exposes a participant assessment through the operation API', async () => {
    const setup = await readyFixture();
    try {
      const { service } = copilotService(setup.f);
      const post = harness(setup.f, service, setup.successor, { approved: true });
      const queued = await post.call('POST', `/api/operations/${setup.operationId}/copilot/assess`);
      expect(queued.status).toBe(202);
      const jobId = (queued.value as { jobId: string }).jobId;
      let completed: { status: string; assessmentId: string } | undefined;
      for (let attempt = 0; attempt < 100; attempt++) {
        const current = service.getJob(setup.operationId, setup.successor, jobId);
        if (current.status !== 'queued' && current.status !== 'running') {
          completed = current as { status: string; assessmentId: string };
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      expect(completed?.status).toBe('completed');

      const read = harness(setup.f, service, setup.successor);
      const job = await read.call('GET', `/api/operations/${setup.operationId}/copilot/jobs/${jobId}`);
      expect(job.status).toBe(200);
      expect((job.value as { status: string }).status).toBe('completed');

      if (!completed) throw new Error('Fixture job did not complete');
      const assessment = await read.call('GET', `/api/operations/${setup.operationId}/copilot/assessments/${completed.assessmentId}`);
      expect(assessment.status).toBe(200);
      expect((assessment.value as { stale: boolean }).stale).toBe(false);
      expect((assessment.value as { assessment: { deterministicVerdict: string } }).assessment.deterministicVerdict).toBe('ready');
    } finally { setup.f.db.close(); }
  });

  it('requires explicit approval and a participant session', async () => {
    const setup = await readyFixture();
    try {
      const { service } = copilotService(setup.f);
      const noApproval = harness(setup.f, service, setup.successor, {});
      await expect(noApproval.call('POST', `/api/operations/${setup.operationId}/copilot/assess`)).rejects.toThrow();

      const queued = await service.enqueue(setup.operationId, setup.successor);
      await service.tick();
      const job = service.getJob(setup.operationId, setup.successor, queued.jobId);
      const outsiderHarness = harness(setup.f, service, Ed25519Keypair.generate().toSuiAddress());
      await expect(outsiderHarness.call('GET', `/api/operations/${setup.operationId}/copilot/assessments/${job.assessmentId}`)).rejects.toThrow('participant');
    } finally { setup.f.db.close(); }
  });
});
