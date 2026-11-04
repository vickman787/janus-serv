import { z } from 'zod';

export const address = z.string().regex(/^0x[0-9a-f]{64}$/);
export const uint = z.string().regex(/^(0|[1-9][0-9]*)$/).refine(v => BigInt(v) <= 18_446_744_073_709_551_615n, 'Exceeds u64');
export const identitySchema = z.object({
  operationId: z.string().uuid(), network: z.enum(['mainnet', 'testnet', 'localnet']),
  chainIdentifier: z.string().min(1), packageId: address, controlObjectId: address,
  proposalId: z.string().uuid(), proposalRevision: uint,
}).strict();
export const checkpointSchema = identitySchema.extend({
  schemaVersion: z.literal(1), administrator: address, successor: address,
  expiresAtMs: uint,
  stage: z.enum(['awaiting_acceptance', 'prepared', 'submitted', 'completed', 'cancelled']),
  checkpointSequence: z.number().int().nonnegative().safe(),
  previousRecordId: z.string().min(1).optional(), previousRecordHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  preparedTransactionDigest: z.string().min(1).optional(),
  confirmedTransactions: z.array(z.object({
    digest: z.string().min(1), action: z.enum(['propose', 'accept', 'cancel', 'change_successor']),
    effectsStatus: z.enum(['success', 'failure']), checkpoint: uint.optional(),
  }).strict()),
  expectedConditions: z.record(z.string(), z.unknown()), approvedPreferenceIds: z.array(z.string()),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).strict().superRefine((v, ctx) => {
  if (v.administrator === v.successor) ctx.addIssue({ code: 'custom', message: 'Self handover is unsupported' });
  if (['prepared', 'submitted'].includes(v.stage) && !v.preparedTransactionDigest) {
    ctx.addIssue({ code: 'custom', message: 'Prepared/submitted stage requires transaction identity' });
  }
  if (v.checkpointSequence > 0 && (!v.previousRecordId || !v.previousRecordHash)) {
    ctx.addIssue({ code: 'custom', message: 'Later checkpoints require a hash-linked predecessor' });
  }
});

export type Identity = z.infer<typeof identitySchema>;
export type Checkpoint = z.infer<typeof checkpointSchema>;
export type LiveState = Identity & {
  administrator: string; successor: string; expiresAtMs: string;
  stage: 'pending' | 'accepted' | 'cancelled';
  objectVersion: string; objectDigest: string; fetchedAtMs: number;
  // Current chain Clock, never browser time, determines proposal expiry.
  clockTimestampMs: string;
  completionDigest?: string;
};
export type Evidence<T> =
  | { kind: 'available'; value: T }
  | { kind: 'absent' }
  | { kind: 'unavailable'; reason: 'timeout' | 'access_denied' | 'indexing' | 'provider' };
export type VerdictCode = 'ready' | 'waiting_actor' | 'waiting_approval' | 'unresolved' | 'completed'
  | 'mismatch' | 'cancelled' | 'expired' | 'no_checkpoint' | 'memory_unavailable'
  | 'chain_unavailable' | 'invalid_checkpoint';
export type Difference = { field: string; remembered: unknown; live: unknown };
export type Verdict = { code: VerdictCode; message: string; differences: Difference[]; nextAction?: 'accept' };
