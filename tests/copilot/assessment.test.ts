import { describe, it, expect } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { ProviderError } from '../../packages/copilot/src/errors.js';
import { makeAssessment, makeDraft, providerMeta, readyFixture, copilotService, fakeProviders } from './support.js';

describe('bounded copilot job orchestration and privacy boundaries', () => {
  it('completes a durable assessment without changing deterministic execution authority', async () => {
    const { f, operationId, successor, admin } = await readyFixture();
    try {
      const { service, providers } = copilotService(f);
      const queued = await service.enqueue(operationId, successor);
      expect(queued.status).toBe('queued');
      expect(queued.deduplicated).toBe(false);
      await service.tick();
      const job = service.getJob(operationId, successor, queued.jobId);
      expect(job.status).toBe('completed');
      expect(job.assessmentId).toBeTruthy();
      const result = service.getAssessment(operationId, successor, job.assessmentId!);
      expect(result.stale).toBe(false);
      expect(result.assessment.deterministicVerdict).toBe('ready');
      expect(result.sources['verdict.code']?.value).toBe('ready');
      expect(providers.calls).toEqual({ dolphin: 1, serv: 1 });
      expect(f.read().count).toBe(1);

      await expect(f.engine.prepare(operationId, 'accept', admin, 'session')).rejects.toThrow('role');
      expect(f.read().count).toBe(1);
    } finally { f.db.close(); }
  });

  it('deduplicates the same operation, actor, evidence hash, and prompt/model version', async () => {
    const { f, operationId, successor } = await readyFixture();
    try {
      const { service, providers } = copilotService(f);
      const first = await service.enqueue(operationId, successor);
      await service.tick();
      const second = await service.enqueue(operationId, successor);
      expect(second.deduplicated).toBe(true);
      expect(second.jobId).toBe(first.jobId);
      expect(second.status).toBe('completed');
      await service.tick();
      expect(providers.calls).toEqual({ dolphin: 1, serv: 1 });
    } finally { f.db.close(); }
  });

  it('marks unsupported model output invalid without storing an assessment', async () => {
    const { f, operationId, successor } = await readyFixture();
    try {
      const providers = fakeProviders();
      providers.serv.plan = async (evidence) => ({
        assessment: {
          ...makeAssessment(evidence),
          steps: [{ kind: 'inspect', instruction: 'Inspect the cited evidence.', sourceIds: ['missing.source'] }],
        },
        meta: providerMeta('serv', 'gpt-5.4-mini'),
      });
      const { service } = copilotService(f, providers);
      const queued = await service.enqueue(operationId, successor);
      await service.tick();
      const job = service.getJob(operationId, successor, queued.jobId);
      expect(job.status).toBe('invalid');
      expect(job.assessmentId).toBeNull();
      expect(job.reasons.join(' ')).toContain('unknown sourceId');
      expect(service.listAssessments(operationId, successor).assessments).toHaveLength(0);
    } finally { f.db.close(); }
  });

  it('records provider failure while leaving the core cockpit functional', async () => {
    const { f, operationId, successor } = await readyFixture();
    try {
      const providers = fakeProviders();
      providers.dolphin.interpret = async () => { throw new ProviderError('Provider request timed out', 'dolphin', 'provider_timeout'); };
      const { service } = copilotService(f, providers);
      const queued = await service.enqueue(operationId, successor);
      await service.tick();
      expect(service.getJob(operationId, successor, queued.jobId).status).toBe('failed');
      const view = await f.engine.view(operationId, successor);
      expect(view.verdict.code).toBe('ready');
      expect(f.read().count).toBe(1);
    } finally { f.db.close(); }
  });

  it('marks an assessment stale when evidence changes before completion', async () => {
    const { f, operationId, successor } = await readyFixture();
    try {
      const providers = fakeProviders();
      providers.serv.plan = async (evidence) => {
        const changed = f.read();
        changed.successor = `0x${'4'.repeat(64)}`;
        f.save(changed);
        return { assessment: makeAssessment(evidence), meta: providerMeta('serv', 'gpt-5.4-mini') };
      };
      const { service } = copilotService(f, providers);
      const queued = await service.enqueue(operationId, successor);
      await service.tick();
      const job = service.getJob(operationId, successor, queued.jobId);
      expect(job.status).toBe('stale');
      expect(job.assessmentId).toBeNull();
      expect(service.listAssessments(operationId, successor).assessments).toHaveLength(0);
    } finally { f.db.close(); }
  });

  it('isolates assessments by requesting actor and rejects non-participants', async () => {
    const { f, operationId, successor, admin } = await readyFixture();
    try {
      const { service } = copilotService(f);
      const outsider = Ed25519Keypair.generate().toSuiAddress();
      await expect(service.enqueue(operationId, outsider)).rejects.toThrow('participant');

      const adminJob = await service.enqueue(operationId, admin);
      await service.tick();
      const completed = service.getJob(operationId, admin, adminJob.jobId);
      expect(completed.status).toBe('completed');
      expect(() => service.getAssessment(operationId, successor, completed.assessmentId!)).toThrow('not found');
      expect(service.listAssessments(operationId, successor).assessments).toHaveLength(0);
    } finally { f.db.close(); }
  });

  it('recovers an interrupted running job after a worker restart', async () => {
    const { f, operationId, successor } = await readyFixture();
    try {
      const { service } = copilotService(f);
      const queued = await service.enqueue(operationId, successor);
      f.db.prepare("UPDATE copilot_jobs SET status='running' WHERE id=?").run(queued.jobId);
      service.recoverInterrupted();
      await service.tick();
      expect(service.getJob(operationId, successor, queued.jobId).status).toBe('completed');
    } finally { f.db.close(); }
  });

  it('rate-limits new charged jobs per actor while allowing exact deduplication', async () => {
    const { f, operationId, successor } = await readyFixture();
    try {
      const { service, config } = copilotService(f);
      config.maxJobsPerActorPerHour = 1;
      const first = await service.enqueue(operationId, successor);
      await service.tick();
      expect((await service.enqueue(operationId, successor)).jobId).toBe(first.jobId);
      f.engine.store.log(operationId, successor, 'fixture', 'A distinct journal version for the rate-limit fixture.');
      await expect(service.enqueue(operationId, successor)).rejects.toThrow('request limit');
    } finally { f.db.close(); }
  });

  it('keeps Dolphin and SERV calls separate and records bounded provider metadata', async () => {
    const { f, operationId, successor } = await readyFixture();
    try {
      const providers = fakeProviders();
      let dolphinDraft = '';
      providers.dolphin.interpret = async (evidence) => {
        dolphinDraft = makeDraft(evidence).evidenceHash;
        providers.calls.dolphin++;
        return { draft: makeDraft(evidence), meta: providerMeta('dolphin', 'deepseek-ai/DeepSeek-V4.1-Flash', 'dolphin-request') };
      };
      providers.serv.plan = async (evidence) => {
        providers.calls.serv++;
        return { assessment: makeAssessment(evidence), meta: providerMeta('serv', 'gpt-5.4-mini', 'serv-request') };
      };
      const { service } = copilotService(f, providers);
      const queued = await service.enqueue(operationId, successor);
      await service.tick();
      const job = service.getJob(operationId, successor, queued.jobId);
      const result = service.getAssessment(operationId, successor, job.assessmentId!);
      expect(dolphinDraft).toBe(result.assessment.evidenceHash);
      expect(result.provider.dolphin.requestId).toBe('dolphin-request');
      expect(result.provider.serv.requestId).toBe('serv-request');
      expect(result.provider.dolphin.model).toContain('DeepSeek');
    } finally { f.db.close(); }
  });
});
