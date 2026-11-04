import { fixture, admin, successor } from './fixtures.js';
import { describe, it, expect } from 'vitest';
import { reconcile, type RecoveryInput } from '../../packages/domain/src/reconcile.js';
import { checkpointSchema, type Checkpoint, type LiveState } from '../../packages/domain/src/models.js';

function checkpoint(f: RecoveryInput) { return (f.memory as { value: Checkpoint }).value; }
function live(f: RecoveryInput) { return (f.chain as { value: LiveState }).value; }

describe('deterministic recovery rules (fixtures, no network)', () => {
  it('permits only authenticated successor with fresh matching evidence', () => {
    expect(reconcile(fixture()).nextAction).toBe('accept');
  });
  it('waits for authenticated actor', () => { const f = fixture(); delete f.authenticatedActor; expect(reconcile(f).code).toBe('waiting_actor'); });
  it.each(['timeout', 'access_denied', 'indexing', 'provider'] as const)('distinguishes memory %s from absence', reason => {
    const f = fixture(); f.memory = { kind: 'unavailable', reason }; expect(reconcile(f).code).toBe('memory_unavailable');
  });
  it('distinguishes confirmed absence', () => { const f = fixture(); f.memory = { kind: 'absent' }; expect(reconcile(f).code).toBe('no_checkpoint'); });
  it('refuses unsigned provenance', () => { const f = fixture(); f.provenanceVerified = false; expect(reconcile(f).code).toBe('invalid_checkpoint'); });
  it('refuses unsupported schema', () => { const f = fixture(); f.memory = { kind: 'available', value: { ...checkpoint(f), schemaVersion: 2 } }; expect(reconcile(f).code).toBe('invalid_checkpoint'); });
  it('refuses stale sequence', () => { const f = fixture(); f.latestSequence = 1; expect(reconcile(f).code).toBe('invalid_checkpoint'); });
  it.each(['operationId', 'network', 'chainIdentifier', 'packageId', 'controlObjectId', 'proposalId', 'proposalRevision'] as const)('rejects wrong reference %s', field => {
    const f = fixture(); (f.expected as Record<string, unknown>)[field] = 'wrong'; expect(reconcile(f).code).toBe('invalid_checkpoint');
  });
  it.each(['operationId', 'network', 'chainIdentifier', 'packageId', 'controlObjectId', 'proposalId', 'proposalRevision', 'successor', 'administrator', 'expiresAtMs'] as const)('blocks live %s mismatch', field => {
    const f = fixture(); (live(f) as unknown as Record<string, unknown>)[field] = field === 'expiresAtMs' ? '30000' : 'changed';
    expect(reconcile(f).code).toBe('mismatch'); expect(reconcile(f).differences[0]?.field).toBe(field);
  });
  it('does not interpret unrelated object version change as a mismatch', () => { const f = fixture(); live(f).objectVersion = '999'; expect(reconcile(f).code).toBe('ready'); });
  it.each([-100, 16000, NaN])('blocks bad/future/stale evidence time %s', nowMs => {
    const f = fixture(); f.nowMs = nowMs; expect(reconcile(f).code).toBe('chain_unavailable');
  });
  it('blocks provider failure', () => { const f = fixture(); f.chain = { kind: 'unavailable', reason: 'provider' }; expect(reconcile(f).code).toBe('chain_unavailable'); });
  it('uses chain clock at expiry boundary', () => { const f = fixture(); live(f).clockTimestampMs = '20000'; expect(reconcile(f).code).toBe('expired'); });
  it('blocks cancelled proposal', () => { const f = fixture(); live(f).stage = 'cancelled'; expect(reconcile(f).code).toBe('cancelled'); });
  it('does not retry an unknown digest even when proposal remains pending', () => {
    const f = fixture(); checkpoint(f).stage = 'submitted'; checkpoint(f).preparedTransactionDigest = 'known-digest'; f.transaction = 'unknown';
    expect(reconcile(f).code).toBe('unresolved'); expect(reconcile(f).nextAction).toBeUndefined();
  });
  it('does not treat unqueried prepared digest as absent', () => {
    const f = fixture(); checkpoint(f).stage = 'prepared'; checkpoint(f).preparedTransactionDigest = 'known-digest'; expect(reconcile(f).code).toBe('unresolved');
  });
  it('requires successful effects as well as completed state', () => {
    const f = fixture(); live(f).stage = 'accepted'; live(f).administrator = successor; expect(reconcile(f).code).toBe('unresolved');
  });
  it('repairs completed memory after verified chain success without another action', () => {
    const f = fixture(); live(f).stage = 'accepted'; live(f).administrator = successor; live(f).completionDigest = 'accept-digest'; f.transaction = 'success'; f.transactionDigest = 'accept-digest';
    expect(reconcile(f).code).toBe('completed'); expect(reconcile(f).nextAction).toBeUndefined();
  });
  it('requires identity even for completed state', () => {
    const f = fixture(); live(f).stage = 'accepted'; live(f).administrator = successor; live(f).completionDigest = 'accept-digest'; live(f).proposalRevision = '2'; f.transaction = 'success'; f.transactionDigest = 'accept-digest';
    expect(reconcile(f).code).toBe('mismatch');
  });
  it('rejects unsafe integer values and self handover', () => {
    const f = fixture(); expect(checkpointSchema.safeParse({ ...checkpoint(f), proposalRevision: '18446744073709551616' }).success).toBe(false);
    expect(checkpointSchema.safeParse({ ...checkpoint(f), successor: admin }).success).toBe(false);
  });
});

it('never reports completion using effects for a different digest', () => {
  const f = fixture();
  const state = (f.chain as { value: LiveState }).value;
  state.stage = 'accepted'; state.administrator = successor; state.completionDigest = 'actual-completion';
  f.transaction = 'success'; f.transactionDigest = 'unrelated-transaction';
  expect(reconcile(f).code).toBe('unresolved');
});
