import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { fromBase64 } from '@mysten/sui/utils';
import { fixture, CONTROL } from '../recovery/fixture.js';
import { buildRecoveryEvidence } from '../../packages/copilot/src/evidence.js';
import type { RecoveryEvidenceBundle, RecoveryAssessment, RecoveryDraft, ProviderRunMeta } from '../../packages/copilot/src/schemas.js';
import { PROMPT_VERSION } from '../../packages/copilot/src/schemas.js';
import { CopilotService } from '../../packages/copilot/src/analyze.js';
import { copilotConfigFromEnv } from '../../packages/copilot/src/config.js';

export async function readyFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'janus-copilot-'));
  const wallet = Ed25519Keypair.generate();
  const admin = wallet.toSuiAddress();
  const successor = Ed25519Keypair.generate().toSuiAddress();
  const f = fixture(dir, admin, successor);
  const created = await f.engine.create({
    label: 'Copilot fixture handover',
    control: CONTROL,
    successor,
    expiresAtMs: '1000000',
    public: false,
  }, admin, 'session');
  const operationId = created.preparation.operationId;
  if (!operationId) throw new Error('Fixture did not create an operation');
  const signed = await wallet.signTransaction(fromBase64(created.preparation.bytes));
  await f.engine.submit(created.preparation.id, admin, 'session', signed);
  return { dir, f, wallet, admin, successor, operationId };
}

export async function readyEvidence() {
  const setup = await readyFixture();
  const view = await setup.f.engine.view(setup.operationId, setup.successor);
  const evidence = buildRecoveryEvidence(view, setup.successor, { journalLimit: 20 });
  return { ...setup, evidence };
}

export function providerMeta(provider: 'dolphin' | 'serv', model: string, requestId = 'fixture-request'): ProviderRunMeta {
  return {
    provider,
    label: provider === 'dolphin' ? 'Dolphin Network' : 'SERV Reasoning',
    model,
    endpointHost: provider === 'dolphin' ? 'lighthouse.dphn.ai' : 'inference-api.openserv.ai',
    requestId,
    usage: { promptTokens: 120, completionTokens: 60, totalTokens: 180 },
    latencyMs: 12,
    at: new Date().toISOString(),
    promptVersion: PROMPT_VERSION,
  };
}

export function makeDraft(evidence: RecoveryEvidenceBundle): RecoveryDraft {
  return {
    schemaVersion: 1,
    operationId: evidence.operationId,
    evidenceHash: evidence.evidenceHash,
    summary: 'Dolphin interpreted the bounded operation evidence as data.',
    findings: [{
      statement: `The deterministic verdict is ${evidence.verdict.code} according to the cited source.`,
      status: 'verified',
      sourceIds: ['verdict.code'],
    }],
    questions: [],
  };
}

export function makeAssessment(evidence: RecoveryEvidenceBundle): RecoveryAssessment {
  const walletReview = evidence.verdict.code === 'ready' && evidence.actor.role === 'successor' && evidence.verdict.nextAction === 'accept';
  const kind = walletReview ? 'request_wallet_review'
    : evidence.verdict.code === 'completed' ? 'inspect'
      : evidence.verdict.code === 'memory_unavailable' || evidence.verdict.code === 'chain_unavailable' ? 'revalidate'
        : 'review';
  return {
    schemaVersion: 1,
    operationId: evidence.operationId,
    evidenceHash: evidence.evidenceHash,
    deterministicVerdict: evidence.verdict.code,
    summary: 'The cited evidence supports the deterministic verdict. This assessment is advisory and the normal revalidation and wallet flow remain mandatory.',
    findings: [{
      statement: `The deterministic verdict is ${evidence.verdict.code} according to the cited source.`,
      status: 'verified',
      sourceIds: ['verdict.code'],
    }],
    questions: [],
    steps: [{
      kind,
      instruction: walletReview
        ? 'Review the acceptance through the existing wallet-review flow.'
        : 'Inspect the cited evidence and use the deterministic revalidation controls.',
      sourceIds: ['verdict.code'],
    }],
  };
}

export function fakeProviders(modelDolphin = 'deepseek-ai/DeepSeek-V4.1-Flash', modelServ = 'gpt-5.4-mini') {
  const calls = { dolphin: 0, serv: 0 };
  return {
    calls,
    dolphin: {
      async interpret(evidence: RecoveryEvidenceBundle) {
        calls.dolphin++;
        return { draft: makeDraft(evidence), meta: providerMeta('dolphin', modelDolphin) };
      },
    },
    serv: {
      async plan(evidence: RecoveryEvidenceBundle) {
        calls.serv++;
        return { assessment: makeAssessment(evidence), meta: providerMeta('serv', modelServ) };
      },
    },
  };
}

export function copilotService(f: ReturnType<typeof fixture>, providers = fakeProviders()) {
  const { config, capabilities } = copilotConfigFromEnv({
    COPILOT_ENABLED: 'true', DOLPHIN_API_KEY: 'fixture-dolphin', SERV_API_KEY: 'fixture-serv',
  });
  const service = new CopilotService({
    store: f.engine.store,
    engine: f.engine,
    dolphin: providers.dolphin,
    serv: providers.serv,
    config,
    capabilities,
  });
  return { service, providers, config, capabilities };
}
