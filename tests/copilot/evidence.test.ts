import { describe, it, expect } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { buildRecoveryEvidence, compactEvidenceForModel, sourceMap } from '../../packages/copilot/src/evidence.js';
import { readyEvidence, readyFixture } from './support.js';

function keys(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach(item => keys(item, found));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) { found.add(key); keys(child, found); }
  }
  return found;
}

describe('RecoveryEvidenceBundle from the actual Engine.view() path', () => {
  it('builds a stable, allowlisted bundle with source-linked facts', async () => {
    const { f, operationId, successor, evidence } = await readyEvidence();
    try {
      const sourceIds = sourceMap(evidence);
      expect(evidence.operationId).toBe(operationId);
      expect(evidence.actor).toEqual({ address: successor, role: 'successor' });
      expect(evidence.checkpoint?.transactions.length).toBe(1);
      expect(sourceIds['verdict.code']?.value).toBe(evidence.verdict.code);
      expect(sourceIds['checkpoint.stage']?.value).toBe('awaiting_acceptance');
      expect(evidence.evidenceHash).toMatch(/^[0-9a-f]{64}$/);

      const allKeys = keys(evidence);
      for (const forbidden of ['bytes', 'signature', 'session_hash', 'privateKey', 'apiKey', 'delegateSecret', 'writerKey']) {
        expect(allKeys.has(forbidden)).toBe(false);
      }

      const view = await f.engine.view(operationId, successor);
      const again = buildRecoveryEvidence(view, successor, { journalLimit: 20 });
      expect(again.evidenceHash).toBe(evidence.evidenceHash);
    } finally { f.db.close(); }
  });

  it('keeps the evidence hash stable when only fetch time and the chain clock advance', async () => {
    const { f, operationId, successor } = await readyFixture();
    try {
      const view = await f.engine.view(operationId, successor);
      const next = view.live ? {
        ...view,
        live: {
          ...view.live,
          fetchedAt: new Date(Date.now() + 5_000).toISOString(),
          clock: (BigInt(view.live.clock) + 5_000n).toString(),
        },
      } : view;
      const first = buildRecoveryEvidence(view, successor, { journalLimit: 20 });
      const second = buildRecoveryEvidence(next, successor, { journalLimit: 20 });
      expect(second.evidenceHash).toBe(first.evidenceHash);
      expect(second.live?.clock).not.toBe(first.live?.clock);
    } finally { f.db.close(); }
  });

  it('marks labels and journal text as untrusted data', async () => {
    const { f, evidence } = await readyEvidence();
    try {
      const sources = sourceMap(evidence);
      expect(sources['operation.label']?.untrusted).toBe(true);
      expect(evidence.journal.length).toBeGreaterThan(0);
      for (const entry of evidence.journal) {
        expect(sources[entry.sourceId]?.untrusted).toBe(true);
      }
    } finally { f.db.close(); }
  });

  it('refuses a non-participant even when the operation is not public', async () => {
    const { f, operationId, successor } = await readyFixture();
    try {
      const view = await f.engine.view(operationId, successor);
      expect(() => buildRecoveryEvidence(view, Ed25519Keypair.generate().toSuiAddress())).toThrow('participant');
    } finally { f.db.close(); }
  });

  it('sends facts and source IDs to models without the full source-value catalog', async () => {
    const { f, evidence } = await readyEvidence();
    try {
      const compact = compactEvidenceForModel(evidence);
      const serialized = JSON.stringify(compact);
      const contentHash = evidence.sources.find(source => source.id === 'checkpoint.contentHash')?.value;
      const memoryId = evidence.sources.find(source => source.id === 'checkpoint.memoryId')?.value;
      expect(compact.allowedSourceIds).toContain('verdict.code');
      expect(compact.verdict.code).toBe(evidence.verdict.code);
      if (contentHash && contentHash !== 'none') expect(serialized).not.toContain(contentHash);
      if (memoryId && memoryId !== 'none') expect(serialized).not.toContain(memoryId);
      expect(serialized.length).toBeLessThan(JSON.stringify(evidence).length);
    } finally { f.db.close(); }
  });

  it('changes the evidence hash when chain facts change', async () => {
    const { f, operationId, successor, evidence } = await readyEvidence();
    try {
      const changed = f.read();
      changed.successor = `0x${'3'.repeat(64)}`;
      f.save(changed);
      const view = await f.engine.view(operationId, successor);
      expect(view.verdict.code).toBe('mismatch');
      const next = buildRecoveryEvidence(view, successor, { journalLimit: 20 });
      expect(next.evidenceHash).not.toBe(evidence.evidenceHash);
      expect(next.verdict.code).toBe('mismatch');
    } finally { f.db.close(); }
  });
});
