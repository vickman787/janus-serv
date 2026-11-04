import { checkpointSchema, type Evidence, type Identity, type LiveState, type Verdict, type Difference } from './models.js';

export type RecoveryInput = {
  memory: Evidence<unknown>; chain: Evidence<LiveState>; expected: Identity;
  authenticatedActor?: string;
  provenanceVerified: boolean;
  // Compare against a trusted discovery pointer, never search result order.
  latestSequence: number;
  nowMs: number; maxEvidenceAgeMs: number;
  transaction: 'none' | 'unknown' | 'success' | 'failure';
  transactionDigest?: string;
};

export function reconcile(input: RecoveryInput): Verdict {
  const verdict = (code: Verdict['code'], message: string, differences: Difference[] = []): Verdict => ({ code, message, differences });
  if (input.memory.kind === 'unavailable') return verdict('memory_unavailable', `Memory ${input.memory.reason}; continuation blocked.`);
  if (input.memory.kind === 'absent') return verdict('no_checkpoint', 'No checkpoint found; continuation blocked.');
  const parsed = checkpointSchema.safeParse(input.memory.value);
  if (!parsed.success || !input.provenanceVerified) return verdict('invalid_checkpoint', 'Checkpoint schema or writer authentication failed.');
  const cp = parsed.data;
  if (cp.checkpointSequence !== input.latestSequence) return verdict('invalid_checkpoint', 'Checkpoint is not the trusted latest sequence.');
  const identityFields = ['operationId', 'network', 'chainIdentifier', 'packageId', 'controlObjectId', 'proposalId', 'proposalRevision'] as const;
  if (identityFields.some(field => cp[field] !== input.expected[field])) return verdict('invalid_checkpoint', 'Checkpoint does not match the trusted recovery reference.');
  if (input.chain.kind !== 'available') return verdict('chain_unavailable', 'Live chain evidence unavailable; continuation blocked.');
  const live = input.chain.value;
  if (!Number.isFinite(live.fetchedAtMs) || !Number.isFinite(input.nowMs) || !Number.isFinite(input.maxEvidenceAgeMs)
    || input.maxEvidenceAgeMs < 0 || live.fetchedAtMs > input.nowMs || input.nowMs - live.fetchedAtMs > input.maxEvidenceAgeMs) {
    return verdict('chain_unavailable', 'Chain evidence is stale or has an invalid timestamp. Revalidate.');
  }
  const differences: Difference[] = [];
  for (const field of identityFields) {
    if (cp[field] !== live[field]) differences.push({ field, remembered: cp[field], live: live[field] });
  }
  if (differences.length) return verdict('mismatch', 'Operation identity or proposal revision changed.', differences);
  if (!/^\d+$/.test(live.clockTimestampMs) || !/^\d+$/.test(live.expiresAtMs)) return verdict('chain_unavailable', 'Chain clock or expiry evidence is invalid.');
  if (cp.successor !== live.successor) differences.push({ field: 'successor', remembered: cp.successor, live: live.successor });
  if (cp.expiresAtMs !== live.expiresAtMs) differences.push({ field: 'expiresAtMs', remembered: cp.expiresAtMs, live: live.expiresAtMs });
  if (differences.length) return verdict('mismatch', 'Proposal conditions changed; review the differences.', differences);
  // A verified accepted proposal plus its successful effects can repair memory after a crash.
  if (live.stage === 'accepted' && live.administrator === cp.successor && live.completionDigest && input.transaction === 'success' && input.transactionDigest === live.completionDigest) {
    return verdict('completed', 'Handover confirmed onchain. Synchronize memory without another transaction.');
  }
  if (live.stage === 'accepted') return verdict('unresolved', 'Acceptance state observed; successful transaction effects still required.');
  if (cp.administrator !== live.administrator) return verdict('mismatch', 'Administrator changed.', [{ field: 'administrator', remembered: cp.administrator, live: live.administrator }]);
  if (live.stage === 'cancelled') return verdict('cancelled', 'Proposal was cancelled onchain.');
  if (cp.stage === 'completed' || cp.stage === 'cancelled') return verdict('mismatch', 'Remembered terminal state disagrees with the live proposal.');
  // Not-found once is not permission to build a replacement, including after expiry.
  if (input.transaction === 'unknown' || (['prepared', 'submitted'].includes(cp.stage) && input.transaction === 'none')) {
    return verdict('unresolved', 'Prepared transaction outcome is unresolved. Inspect its digest before any new action.');
  }
  if (input.transaction === 'success' && cp.preparedTransactionDigest) return verdict('unresolved', 'Successful effects require matching business-state verification.');
  if (BigInt(live.clockTimestampMs) >= BigInt(live.expiresAtMs)) return verdict('expired', 'Proposal expired according to the Sui clock.');
  if (input.authenticatedActor !== cp.successor) return verdict('waiting_actor', 'Waiting for the authenticated nominated successor.');
  if (cp.stage === 'prepared') return verdict('waiting_approval', 'Review the prepared transaction and approve with your wallet.');
  return { ...verdict('ready', 'Memory and live state agree. The successor may review acceptance.'), nextAction: 'accept' };
}
