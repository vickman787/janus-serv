import { createHash } from 'node:crypto';
import type { Engine } from '../../../apps/api/src/engine.js';
import { CopilotError } from './errors.js';
import {
  ASSESSMENT_SCHEMA_VERSION,
  recoveryEvidenceBundleSchema,
  type EvidenceSource,
  type RecoveryEvidenceBundle,
} from './schemas.js';

type EngineView = Awaited<ReturnType<Engine['view']>>;

export type EvidencePreparation = {
  digest: string;
  action: string;
  state: string;
  created: string;
  expires: number;
};

export type EvidenceOptions = {
  preparation?: EvidencePreparation | null;
  journalLimit?: number;
  now?: Date;
};

const valueText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return JSON.stringify(value);
};

export function buildRecoveryEvidence(view: EngineView, actor: string, options: EvidenceOptions = {}): RecoveryEvidenceBundle {
  const role = view.operation.administrator === actor ? 'administrator'
    : view.operation.successor === actor ? 'successor' : undefined;
  if (!role) throw new CopilotError('Recovery Copilot requires an authenticated operation participant', 403, 'forbidden');

  const sources: EvidenceSource[] = [];
  const sourceIds = new Set<string>();
  const add = (id: string, category: EvidenceSource['category'], label: string, value: unknown, untrusted = false): string => {
    if (sourceIds.has(id)) return id;
    sourceIds.add(id);
    const text = valueText(value);
    sources.push({ id, category, label, value: text.length > 1500 ? `${text.slice(0, 1497)}...` : text, ...(untrusted ? { untrusted: true } : {}) });
    return id;
  };

  const operation = view.operation;
  add('operation.id', 'operation', 'Operation identifier', operation.id);
  add('operation.label', 'operation', 'Operation label (untrusted text)', operation.label, true);
  add('operation.administrator', 'operation', 'Remembered administrator', operation.administrator);
  add('operation.successor', 'operation', 'Remembered successor', operation.successor);
  add('operation.revision', 'operation', 'Indexed proposal revision', operation.revision);
  add('operation.control', 'operation', 'Control object', operation.control);
  add('operation.proposal', 'operation', 'Proposal object', operation.proposal);
  add('operation.status', 'operation', 'Indexed operation status', operation.status);
  add('operation.sequence', 'operation', 'Indexed checkpoint sequence', operation.sequence);
  add('operation.updated', 'operation', 'Indexed operation update time', operation.updated);

  let memoryId: string | null = null;
  let contentHash: string | null = null;
  if (operation.ref) {
    try {
      const ref = JSON.parse(operation.ref) as { memoryId?: unknown; contentHash?: unknown };
      memoryId = typeof ref.memoryId === 'string' ? ref.memoryId : null;
      contentHash = typeof ref.contentHash === 'string' ? ref.contentHash : null;
    } catch {
      memoryId = null;
      contentHash = null;
    }
  }

  const checkpoint = view.checkpoint ? {
    sequence: operation.sequence,
    stage: view.checkpoint.stage,
    proposalId: view.checkpoint.proposalId ?? null,
    proposalRevision: view.checkpoint.proposalRevision,
    expiresAtMs: view.checkpoint.expiresAtMs,
    administrator: view.checkpoint.administrator,
    successor: view.checkpoint.successor,
    memoryId,
    contentHash,
    preparedDigest: view.checkpoint.preparedDigest ?? null,
    transactions: view.checkpoint.confirmedTransactions.slice(0, 20).map(t => ({
      digest: t.digest,
      action: t.action,
      checkpoint: t.checkpoint,
    })),
  } : null;

  if (checkpoint) {
    add('checkpoint.sequence', 'checkpoint', 'Validated checkpoint sequence', checkpoint.sequence);
    add('checkpoint.stage', 'checkpoint', 'Validated checkpoint stage', checkpoint.stage);
    add('checkpoint.proposalRevision', 'checkpoint', 'Remembered proposal revision', checkpoint.proposalRevision);
    add('checkpoint.expiresAtMs', 'checkpoint', 'Remembered expiry (chain milliseconds)', checkpoint.expiresAtMs);
    add('checkpoint.administrator', 'checkpoint', 'Remembered checkpoint administrator', checkpoint.administrator);
    add('checkpoint.successor', 'checkpoint', 'Remembered checkpoint successor', checkpoint.successor);
    add('checkpoint.proposalId', 'checkpoint', 'Remembered proposal object', checkpoint.proposalId ?? 'none');
    add('checkpoint.memoryId', 'checkpoint', 'Walrus memory identifier', checkpoint.memoryId ?? 'none');
    add('checkpoint.contentHash', 'checkpoint', 'Validated memory content hash', checkpoint.contentHash ?? 'none');
    add('checkpoint.preparedDigest', 'checkpoint', 'Prepared transaction digest', checkpoint.preparedDigest ?? 'none');
    checkpoint.transactions.forEach((transaction, index) => {
      add(`checkpoint.transaction.${index}.digest`, 'checkpoint', `Confirmed ${transaction.action} transaction digest`, transaction.digest);
      add(`checkpoint.transaction.${index}.checkpoint`, 'checkpoint', `Confirmed ${transaction.action} checkpoint`, transaction.checkpoint ?? 'none');
    });
  }

  const live = view.live ? {
    fetchedAt: view.live.fetchedAt,
    clock: view.live.clock,
    control: {
      administrator: view.live.control.administrator,
      revision: view.live.control.revision,
      pendingProposal: view.live.control.pending_proposal,
      counter: view.live.control.counter,
    },
    proposal: view.live.proposal ? {
      stage: view.live.proposal.stage,
      revision: view.live.proposal.revision,
      successor: view.live.proposal.successor,
      expiresAtMs: view.live.proposal.expires_at_ms,
      previousTransaction: view.live.proposal.previousTransaction,
    } : null,
  } : null;

  if (live) {
    add('live.fetchedAt', 'live', 'Live evidence fetch time', live.fetchedAt);
    add('live.clock', 'live', 'Sui Clock timestamp (milliseconds)', live.clock);
    add('live.control.administrator', 'live', 'Live control administrator', live.control.administrator);
    add('live.control.revision', 'live', 'Live control revision', live.control.revision);
    add('live.control.pendingProposal', 'live', 'Live control pending proposal', live.control.pendingProposal);
    add('live.control.counter', 'live', 'Live control counter', live.control.counter);
    if (live.proposal) {
      add('live.proposal.stage', 'live', 'Live proposal stage', live.proposal.stage);
      add('live.proposal.revision', 'live', 'Live proposal revision', live.proposal.revision);
      add('live.proposal.successor', 'live', 'Live proposal successor', live.proposal.successor);
      add('live.proposal.expiresAtMs', 'live', 'Live proposal expiry (chain milliseconds)', live.proposal.expiresAtMs);
      add('live.proposal.previousTransaction', 'live', 'Proposal previous transaction digest', live.proposal.previousTransaction ?? 'none');
    }
  }

  const preparation = options.preparation ? {
    digest: options.preparation.digest,
    action: options.preparation.action,
    state: options.preparation.state,
    createdAt: options.preparation.created,
    expiresAt: options.preparation.expires,
  } : null;
  if (preparation) {
    add('preparation.digest', 'preparation', 'Latest preparation transaction digest', preparation.digest);
    add('preparation.action', 'preparation', 'Latest preparation action', preparation.action);
    add('preparation.state', 'preparation', 'Latest preparation state', preparation.state);
    add('preparation.createdAt', 'preparation', 'Latest preparation creation time', preparation.createdAt);
    add('preparation.expiresAt', 'preparation', 'Latest preparation approval-window expiry', preparation.expiresAt);
  }

  const verdict = {
    code: view.verdict.code,
    message: view.verdict.message,
    differences: view.verdict.differences.map(difference => ({
      field: String(difference.field),
      remembered: valueText(difference.remembered),
      live: valueText(difference.live),
    })),
    nextAction: view.verdict.nextAction ?? null,
  };
  add('verdict.code', 'verdict', 'Deterministic verdict code', verdict.code);
  add('verdict.message', 'verdict', 'Deterministic verdict message', verdict.message);
  add('verdict.nextAction', 'verdict', 'Deterministic permitted next action', verdict.nextAction ?? 'none');
  verdict.differences.forEach((difference, index) => {
    const safeField = difference.field.replace(/[^a-zA-Z0-9_.-]/g, '_');
    add(`verdict.difference.${safeField}.remembered`, 'verdict', `Remembered ${difference.field}`, difference.remembered);
    add(`verdict.difference.${safeField}.live`, 'verdict', `Live ${difference.field}`, difference.live);
    add(`verdict.difference.${index}.field`, 'verdict', 'Difference field', difference.field);
  });

  const journalLimit = Math.max(0, Math.min(50, options.journalLimit ?? 20));
  const journal = view.journal.slice(0, journalLimit).map(row => {
    const entry = row as { id?: unknown; kind?: unknown; message?: unknown; created?: unknown };
    const id = typeof entry.id === 'number' ? entry.id : Number(entry.id ?? 0);
    const message = valueText(entry.message).slice(0, 1000);
    const sourceId = add(`journal.${id}`, 'journal', `Journal entry ${id} (untrusted text)`, message, true);
    return {
      id: Number.isSafeInteger(id) && id >= 0 ? id : 0,
      sourceId,
      kind: valueText(entry.kind).slice(0, 80) || 'journal',
      message,
      createdAt: valueText(entry.created).slice(0, 80),
    };
  });

  const preference = view.preference ? {
    id: view.preference.id,
    revision: view.preference.revision,
    reviewStyle: view.preference.reviewStyle,
    explanation: view.preference.explanation,
    memoryId: typeof view.preference.ref?.memoryId === 'string' ? view.preference.ref.memoryId : null,
  } : null;
  if (preference) {
    add('preference.id', 'preference', 'Approved preference identifier', preference.id);
    add('preference.revision', 'preference', 'Approved preference revision', preference.revision);
    add('preference.reviewStyle', 'preference', 'Approved review style', preference.reviewStyle);
    add('preference.explanation', 'preference', 'Approved preference explanation (untrusted text)', preference.explanation, true);
    add('preference.memoryId', 'preference', 'Preference memory identifier', preference.memoryId ?? 'none');
  }

  const bundle = {
    schemaVersion: ASSESSMENT_SCHEMA_VERSION as 1,
    generatedAt: (options.now ?? new Date()).toISOString(),
    operationId: operation.id,
    network: 'testnet' as const,
    chainIdentifier: view.checkpoint?.chainIdentifier ?? null,
    packageId: view.checkpoint?.packageId ?? null,
    controlObjectId: operation.control,
    proposalId: checkpoint?.proposalId ?? null,
    operation: {
      label: operation.label,
      administrator: operation.administrator,
      successor: operation.successor,
      revision: operation.revision,
      status: operation.status,
      sequence: operation.sequence,
      updated: operation.updated,
    },
    actor: { address: actor, role },
    checkpoint,
    live,
    preparation,
    preference,
    journal,
    verdict,
    sources,
  };

  const hashable = {
    ...bundle,
    generatedAt: undefined,
    // Fetch time and the continuously advancing chain clock are not semantic
    // evidence changes; the deterministic verdict already encodes expiry.
    sources: sources.filter(source => source.id !== 'live.fetchedAt' && source.id !== 'live.clock'),
    live: live ? { ...live, fetchedAt: undefined, clock: undefined } : null,
  };
  const evidenceHash = createHash('sha256').update(JSON.stringify(hashable)).digest('hex');
  return recoveryEvidenceBundleSchema.parse({ ...bundle, evidenceHash });
}

export function sourceMap(evidence: RecoveryEvidenceBundle): Record<string, EvidenceSource> {
  return Object.fromEntries(evidence.sources.map(source => [source.id, source]));
}

// Model prompts contain the validated facts and source IDs, but not the full
// source-value catalog or memory identifiers. This keeps provider input small
// and avoids sending more operation data than the interpretation requires.
export function compactEvidenceForModel(evidence: RecoveryEvidenceBundle) {
  return {
    schemaVersion: evidence.schemaVersion,
    operationId: evidence.operationId,
    evidenceHash: evidence.evidenceHash,
    network: evidence.network,
    chainIdentifier: evidence.chainIdentifier,
    packageId: evidence.packageId,
    controlObjectId: evidence.controlObjectId,
    proposalId: evidence.proposalId,
    operation: evidence.operation,
    actor: evidence.actor,
    checkpoint: evidence.checkpoint ? {
      sequence: evidence.checkpoint.sequence,
      stage: evidence.checkpoint.stage,
      proposalId: evidence.checkpoint.proposalId,
      proposalRevision: evidence.checkpoint.proposalRevision,
      expiresAtMs: evidence.checkpoint.expiresAtMs,
      administrator: evidence.checkpoint.administrator,
      successor: evidence.checkpoint.successor,
      preparedDigest: evidence.checkpoint.preparedDigest,
      transactions: evidence.checkpoint.transactions,
    } : null,
    live: evidence.live,
    preparation: evidence.preparation,
    preference: evidence.preference ? {
      id: evidence.preference.id,
      revision: evidence.preference.revision,
      reviewStyle: evidence.preference.reviewStyle,
      explanation: evidence.preference.explanation,
    } : null,
    journal: evidence.journal,
    verdict: evidence.verdict,
    allowedSourceIds: evidence.sources.map(source => source.id),
  };
}
