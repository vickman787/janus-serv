import { z } from 'zod';
import { address, uint } from '../../domain/src/models.js';

export const PROMPT_VERSION = 'janus-copilot-v1';
export const ASSESSMENT_SCHEMA_VERSION = 1;

export const sourceCategorySchema = z.enum([
  'operation', 'checkpoint', 'live', 'preparation', 'journal', 'preference', 'verdict',
]);

export const evidenceSourceSchema = z.object({
  id: z.string().min(1).max(160),
  category: sourceCategorySchema,
  label: z.string().min(1).max(200),
  value: z.string().max(1500),
  untrusted: z.boolean().optional(),
}).strict();

const confirmedTransactionSchema = z.object({
  digest: z.string().min(1).max(200),
  action: z.string().min(1).max(80),
  checkpoint: z.string().nullable(),
}).strict();

export const recoveryEvidenceBundleSchema = z.object({
  schemaVersion: z.literal(ASSESSMENT_SCHEMA_VERSION),
  generatedAt: z.iso.datetime(),
  operationId: z.string().uuid(),
  network: z.literal('testnet'),
  chainIdentifier: z.string().max(200).nullable(),
  packageId: address.nullable(),
  controlObjectId: address,
  proposalId: address.nullable(),
  operation: z.object({
    label: z.string().max(100),
    administrator: address,
    successor: address,
    revision: uint,
    status: z.string().min(1).max(80),
    sequence: z.number().int().nonnegative().safe(),
    updated: z.string().min(1).max(80),
  }).strict(),
  actor: z.object({
    address,
    role: z.enum(['administrator', 'successor']),
  }).strict(),
  checkpoint: z.object({
    sequence: z.number().int().nonnegative().safe(),
    stage: z.string().min(1).max(80),
    proposalId: address.nullable(),
    proposalRevision: uint,
    expiresAtMs: uint,
    administrator: address,
    successor: address,
    memoryId: z.string().max(300).nullable(),
    contentHash: z.string().max(200).nullable(),
    preparedDigest: z.string().max(200).nullable(),
    transactions: z.array(confirmedTransactionSchema).max(20),
  }).strict().nullable(),
  live: z.object({
    fetchedAt: z.string().min(1).max(80),
    clock: uint,
    control: z.object({
      administrator: address,
      revision: uint,
      pendingProposal: address,
      counter: uint,
    }).strict(),
    proposal: z.object({
      stage: z.number().int().min(0).max(4),
      revision: uint,
      successor: address,
      expiresAtMs: uint,
      previousTransaction: z.string().max(200).nullable(),
    }).strict().nullable(),
  }).strict().nullable(),
  preparation: z.object({
    digest: z.string().min(1).max(200),
    action: z.string().min(1).max(80),
    state: z.string().min(1).max(80),
    createdAt: z.string().min(1).max(80),
    expiresAt: z.number().int().nonnegative().safe(),
  }).strict().nullable(),
  preference: z.object({
    id: z.string().min(1).max(200),
    revision: z.number().int().nonnegative().safe(),
    reviewStyle: z.enum(['detailed', 'concise']),
    explanation: z.string().max(1000),
    memoryId: z.string().max(300).nullable(),
  }).strict().nullable(),
  journal: z.array(z.object({
    id: z.number().int().nonnegative().safe(),
    sourceId: z.string().min(1).max(160),
    kind: z.string().min(1).max(80),
    message: z.string().max(1000),
    createdAt: z.string().min(1).max(80),
  }).strict()).max(50),
  verdict: z.object({
    code: z.string().min(1).max(80),
    message: z.string().min(1).max(1000),
    differences: z.array(z.object({
      field: z.string().min(1).max(120),
      remembered: z.string().max(1000),
      live: z.string().max(1000),
    }).strict()).max(20),
    nextAction: z.string().max(80).nullable(),
  }).strict(),
  sources: z.array(evidenceSourceSchema).min(1).max(400),
  evidenceHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export type RecoveryEvidenceBundle = z.infer<typeof recoveryEvidenceBundleSchema>;
export type EvidenceSource = z.infer<typeof evidenceSourceSchema>;

const findingSchema = z.object({
  statement: z.string().min(1).max(500),
  status: z.enum(['verified', 'uncertain']),
  sourceIds: z.array(z.string().min(1).max(160)).max(10),
}).strict();

export const recoveryDraftSchema = z.object({
  schemaVersion: z.literal(ASSESSMENT_SCHEMA_VERSION),
  operationId: z.string().uuid(),
  evidenceHash: z.string().regex(/^[0-9a-f]{64}$/),
  summary: z.string().min(1).max(2000),
  findings: z.array(findingSchema).max(20),
  questions: z.array(z.string().min(1).max(300)).max(10),
}).strict();

export const stepKindSchema = z.enum(['inspect', 'wait', 'review', 'revalidate', 'request_wallet_review']);

export const recoveryAssessmentSchema = z.object({
  schemaVersion: z.literal(ASSESSMENT_SCHEMA_VERSION),
  operationId: z.string().uuid(),
  evidenceHash: z.string().regex(/^[0-9a-f]{64}$/),
  deterministicVerdict: z.string().min(1).max(80),
  summary: z.string().min(1).max(2000),
  findings: z.array(findingSchema).max(20),
  questions: z.array(z.string().min(1).max(300)).max(10),
  steps: z.array(z.object({
    kind: stepKindSchema,
    instruction: z.string().min(1).max(500),
    sourceIds: z.array(z.string().min(1).max(160)).max(10),
  }).strict()).max(10),
}).strict();

export type RecoveryDraft = z.infer<typeof recoveryDraftSchema>;
export type RecoveryAssessment = z.infer<typeof recoveryAssessmentSchema>;

export const copilotJobStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'invalid', 'stale']);
export type CopilotJobStatus = z.infer<typeof copilotJobStatusSchema>;

export const providerRunMetaSchema = z.object({
  provider: z.enum(['dolphin', 'serv']),
  label: z.string().min(1).max(120),
  model: z.string().min(1).max(200),
  endpointHost: z.string().min(1).max(255),
  requestId: z.string().max(200).nullable(),
  usage: z.object({
    promptTokens: z.number().int().nonnegative().nullable(),
    completionTokens: z.number().int().nonnegative().nullable(),
    totalTokens: z.number().int().nonnegative().nullable(),
  }).strict(),
  latencyMs: z.number().int().nonnegative().safe(),
  at: z.string().min(1).max(80),
  promptVersion: z.string().min(1).max(120),
}).strict();

export type ProviderRunMeta = z.infer<typeof providerRunMetaSchema>;

export const providerMetadataSchema = z.object({
  dolphin: providerRunMetaSchema,
  serv: providerRunMetaSchema,
  schemaVersion: z.literal(ASSESSMENT_SCHEMA_VERSION),
}).strict();

export type ProviderMetadata = z.infer<typeof providerMetadataSchema>;

export const assessmentSnapshotSchema = z.object({
  checkpointSequence: z.number().int().nonnegative().safe(),
  operationUpdated: z.string().min(1).max(80),
  verdictCode: z.string().min(1).max(80),
  checkpointRevision: uint,
  liveRevision: uint.nullable(),
  liveProposalStage: z.number().int().min(0).max(4).nullable(),
}).strict();

export type AssessmentSnapshot = z.infer<typeof assessmentSnapshotSchema>;

export const assessmentResponseSchema = z.object({
  assessment: recoveryAssessmentSchema,
  sources: z.record(z.string(), evidenceSourceSchema),
  provider: providerMetadataSchema,
  snapshot: assessmentSnapshotSchema,
  createdAt: z.string().min(1).max(80),
  stale: z.boolean(),
}).strict();

export type AssessmentResponse = z.infer<typeof assessmentResponseSchema>;

export const jobResponseSchema = z.object({
  jobId: z.string().uuid(),
  status: copilotJobStatusSchema,
  assessmentId: z.string().uuid().nullable(),
  evidenceHash: z.string().regex(/^[0-9a-f]{64}$/),
  error: z.string().max(2000).nullable(),
  reasons: z.array(z.string().max(500)).max(20),
  attempts: z.number().int().nonnegative().safe(),
  createdAt: z.string().min(1).max(80),
  updatedAt: z.string().min(1).max(80),
}).strict();

export type JobResponse = z.infer<typeof jobResponseSchema>;

export const assessmentSummarySchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().min(1).max(80),
  verdictCode: z.string().min(1).max(80),
  evidenceHash: z.string().regex(/^[0-9a-f]{64}$/),
  checkpointSequence: z.number().int().nonnegative().safe(),
  operationUpdated: z.string().min(1).max(80),
  summary: z.string().max(2000),
}).strict();

export type AssessmentSummary = z.infer<typeof assessmentSummarySchema>;
