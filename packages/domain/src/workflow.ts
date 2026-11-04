import { z } from 'zod';
import { address, uint } from './models.js';
export const workflowSchema = z.object({
  schemaVersion: z.literal(1), operationId: z.string().uuid(), label: z.string().max(100), network: z.literal('testnet'),
  chainIdentifier: z.string().min(1), packageId: address, controlObjectId: address, proposalId: address.optional(),
  administrator: address, successor: address, proposalRevision: uint, expiresAtMs: uint,
  stage: z.enum(['draft','prepared','submitted','awaiting_acceptance','completed','cancelled','expired']),
  preparedDigest: z.string().optional(), intendedSuccessor: address.optional(), action: z.string().optional(),
  confirmedTransactions: z.array(z.object({ digest: z.string(), action: z.string(), checkpoint: z.string().nullable() })),
}).strict();
export type Workflow = z.infer<typeof workflowSchema>;
export type OperationRow = { id: string; label: string; administrator: string; successor: string; control: string; proposal: string | null; revision: string; status: string; public: number; ref: string | null; sequence: number; updated: string };
