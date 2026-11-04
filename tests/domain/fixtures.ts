import type { RecoveryInput } from '../../packages/domain/src/reconcile.js';
import type { Checkpoint, LiveState } from '../../packages/domain/src/models.js';
export const admin = `0x${'1'.repeat(64)}`, successor = `0x${'2'.repeat(64)}`;
export function fixture(): RecoveryInput {
  const identity = {
    operationId: '550e8400-e29b-41d4-a716-446655440000', network: 'testnet' as const,
    chainIdentifier: 'test-chain', packageId: `0x${'a'.repeat(64)}`, controlObjectId: `0x${'b'.repeat(64)}`,
    proposalId: '550e8400-e29b-41d4-a716-446655440001', proposalRevision: '1',
  };
  const cp: Checkpoint = {
    ...identity, schemaVersion: 1, administrator: admin, successor, expiresAtMs: '20000',
    stage: 'awaiting_acceptance', checkpointSequence: 0, confirmedTransactions: [],
    expectedConditions: {}, approvedPreferenceIds: [], createdAt: '2026-10-28T20:00:00Z', updatedAt: '2026-10-28T20:00:00Z',
  };
  const live: LiveState = {
    ...identity, administrator: admin, successor, expiresAtMs: '20000', stage: 'pending',
    objectVersion: '123', objectDigest: 'object-digest', fetchedAtMs: 10000, clockTimestampMs: '10000',
  };
  return { memory: { kind: 'available', value: cp }, chain: { kind: 'available', value: live }, expected: identity,
    authenticatedActor: successor, provenanceVerified: true, latestSequence: 0, nowMs: 10000, maxEvidenceAgeMs: 5000, transaction: 'none' };
}
