import { randomUUID } from 'node:crypto';
import type { Engine } from '../../../apps/api/src/engine.js';
import { BusyError, Store } from '../../../apps/api/src/store.js';
import { CopilotError, CopilotValidationError } from './errors.js';
import type { CopilotCapabilities, CopilotConfig } from './config.js';
import { buildRecoveryEvidence, sourceMap, type EvidencePreparation } from './evidence.js';
import { validateAssessment, validateDraft } from './validate.js';
import {
  providerMetadataSchema,
  recoveryAssessmentSchema,
  recoveryEvidenceBundleSchema,
  type AssessmentSummary,
  type CopilotJobStatus,
  type JobResponse,
  type ProviderMetadata,
  type RecoveryAssessment,
  type RecoveryDraft,
  type RecoveryEvidenceBundle,
} from './schemas.js';

export type DolphinAnalyst = {
  interpret(evidence: RecoveryEvidenceBundle, options: { maxTokens: number }): Promise<{ draft: RecoveryDraft; meta: ProviderMetadata['dolphin'] }>;
};

export type ServPlanner = {
  plan(evidence: RecoveryEvidenceBundle, draft: RecoveryDraft, options: { maxTokens: number }): Promise<{ assessment: RecoveryAssessment; meta: ProviderMetadata['serv'] }>;
};

export type AnalyzeDependencies = {
  dolphin: DolphinAnalyst;
  serv: ServPlanner;
  config: CopilotConfig;
};

export type AnalyzeResult = {
  assessment: RecoveryAssessment;
  draft: RecoveryDraft;
  provider: ProviderMetadata;
  warnings: string[];
};

export async function analyzeRecovery(evidence: RecoveryEvidenceBundle, dependencies: AnalyzeDependencies): Promise<AnalyzeResult> {
  const serialized = JSON.stringify(evidence);
  if (serialized.length > dependencies.config.maxPromptChars) {
    throw new CopilotError('Evidence bundle exceeds the configured copilot prompt limit', 413, 'evidence_too_large');
  }
  const dolphin = await dependencies.dolphin.interpret(evidence, { maxTokens: dependencies.config.maxOutputTokens });
  const draftValidation = validateDraft(dolphin.draft, evidence);
  if (!draftValidation.ok) {
    throw new CopilotValidationError('Dolphin interpretation was rejected by application validation', draftValidation.reasons);
  }
  const serv = await dependencies.serv.plan(evidence, draftValidation.value, { maxTokens: dependencies.config.maxOutputTokens });
  const assessmentValidation = validateAssessment(serv.assessment, evidence);
  if (!assessmentValidation.ok) {
    throw new CopilotValidationError('SERV recovery plan was rejected by application validation', assessmentValidation.reasons);
  }
  const provider = providerMetadataSchema.parse({ dolphin: dolphin.meta, serv: serv.meta, schemaVersion: 1 });
  return {
    assessment: assessmentValidation.value,
    draft: draftValidation.value,
    provider,
    warnings: [...draftValidation.warnings, ...assessmentValidation.warnings],
  };
}

type OperationRow = ReturnType<Engine['row']>;

type CopilotJobRow = {
  id: string;
  operation_id: string;
  actor: string;
  evidence_hash: string;
  evidence_json: string;
  status: CopilotJobStatus;
  prompt_version: string;
  dolphin_model: string;
  serv_model: string;
  assessment_id: string | null;
  error: string | null;
  reasons: string | null;
  attempts: number;
  created: string;
  updated: string;
  started: string | null;
  finished: string | null;
  usage_json: string | null;
};

type CopilotAssessmentRow = {
  id: string;
  job_id: string;
  operation_id: string;
  actor: string;
  evidence_hash: string;
  evidence_json: string;
  assessment_json: string;
  validation_json: string;
  provider_json: string;
  checkpoint_sequence: number;
  operation_updated: string;
  verdict_code: string;
  checkpoint_revision: string;
  live_revision: string | null;
  live_proposal_stage: number | null;
  created: string;
};

export type EnqueueResult = {
  jobId: string;
  status: CopilotJobStatus;
  assessmentId: string | null;
  evidenceHash: string;
  deduplicated: boolean;
};

export type CopilotServiceOptions = {
  store: Store;
  engine: Engine;
  dolphin: DolphinAnalyst;
  serv: ServPlanner;
  config: CopilotConfig;
  capabilities: CopilotCapabilities;
};

const iso = () => new Date().toISOString();

function parseReasons(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((reason): reason is string => typeof reason === 'string').slice(0, 20) : [];
  } catch { return []; }
}

export class CopilotService {
  private active = false;

  constructor(private readonly options: CopilotServiceOptions) {}

  get config() { return this.options.config; }
  get db() { return this.options.store.db; }

  capabilities() { return this.options.capabilities; }

  participant(operationId: string, actor: string): OperationRow {
    const row = this.options.engine.row(operationId);
    if (row.administrator !== actor && row.successor !== actor) {
      throw new CopilotError('Recovery Copilot requires an authenticated operation participant', 403, 'forbidden');
    }
    return row;
  }

  async buildEvidence(operationId: string, actor: string): Promise<RecoveryEvidenceBundle> {
    this.participant(operationId, actor);
    const view = await this.options.engine.view(operationId, actor);
    const preparation = this.db.prepare(
      "SELECT * FROM preparations WHERE operation_id=? AND state!='discarded' ORDER BY created DESC LIMIT 1",
    ).get(operationId) as (EvidencePreparation & { operation_id?: string | null }) | undefined;
    return buildRecoveryEvidence(view, actor, {
      preparation: preparation ? {
        digest: preparation.digest,
        action: preparation.action,
        state: preparation.state,
        created: preparation.created,
        expires: preparation.expires,
      } : null,
      journalLimit: this.config.journalLimit,
    });
  }

  async enqueue(operationId: string, actor: string): Promise<EnqueueResult> {
    if (!this.config.enabled) throw new CopilotError(this.config.disabledReason ?? 'Recovery Copilot is not configured', 503, 'not_configured');
    this.participant(operationId, actor);
    const evidence = await this.buildEvidence(operationId, actor);
    const evidenceJson = JSON.stringify(evidence);
    if (evidenceJson.length > this.config.maxPromptChars) {
      throw new CopilotError('Evidence bundle exceeds the configured copilot prompt limit', 413, 'evidence_too_large');
    }

    const existing = this.db.prepare(
      `SELECT * FROM copilot_jobs
       WHERE operation_id=? AND actor=? AND evidence_hash=? AND prompt_version=? AND dolphin_model=? AND serv_model=?
       AND status IN ('queued','running','completed')
       ORDER BY created DESC LIMIT 1`,
    ).get(operationId, actor, evidence.evidenceHash, this.options.capabilities.promptVersion, this.config.dolphin.model, this.config.serv.model) as CopilotJobRow | undefined;
    if (existing && !(existing.status === 'completed' && !existing.assessment_id)) {
      return {
        jobId: existing.id,
        status: existing.status,
        assessmentId: existing.assessment_id,
        evidenceHash: existing.evidence_hash,
        deduplicated: true,
      };
    }

    const since = new Date(Date.now() - 60 * 60_000).toISOString();
    const recent = this.db.prepare('SELECT COUNT(*) AS count FROM copilot_jobs WHERE actor=? AND created>?').get(actor, since) as { count: number };
    if (recent.count >= this.config.maxJobsPerActorPerHour) {
      throw new CopilotError('Recovery Copilot request limit reached for this wallet. Try again later.', 429, 'rate_limited');
    }

    const id = randomUUID(), created = iso();
    this.db.prepare(`INSERT INTO copilot_jobs
      (id,operation_id,actor,evidence_hash,evidence_json,status,prompt_version,dolphin_model,serv_model,assessment_id,error,reasons,attempts,created,updated,started,finished,usage_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, operationId, actor, evidence.evidenceHash, evidenceJson, 'queued', this.options.capabilities.promptVersion,
      this.config.dolphin.model, this.config.serv.model, null, null, null, 0, created, created, null, null, null,
    );
    return { jobId: id, status: 'queued', assessmentId: null, evidenceHash: evidence.evidenceHash, deduplicated: false };
  }

  recoverInterrupted() {
    this.db.prepare("UPDATE copilot_jobs SET status='queued', updated=?, error='Recovered after an interrupted copilot worker' WHERE status='running'").run(iso());
  }

  async tick() {
    if (this.active) return;
    this.active = true;
    try {
      const rows = this.db.prepare("SELECT id FROM copilot_jobs WHERE status='queued' ORDER BY created LIMIT 2").all() as { id: string }[];
      for (const row of rows) await this.process(row.id);
    } finally {
      this.active = false;
    }
  }

  private async process(jobId: string) {
    try {
      await this.options.store.lease(`copilot-job:${jobId}`, async () => {
        const job = this.jobRow(jobId);
        if (!job || job.status !== 'queued') return;
        const started = iso();
        this.db.prepare("UPDATE copilot_jobs SET status='running', started=?, updated=?, attempts=attempts+1, error=NULL, reasons=NULL WHERE id=? AND status='queued'")
          .run(started, started, jobId);

        let evidence: RecoveryEvidenceBundle;
        try {
          evidence = recoveryEvidenceBundleSchema.parse(JSON.parse(job.evidence_json));
        } catch {
          this.finish(jobId, 'invalid', null, 'Stored evidence bundle is not valid', ['Stored evidence failed schema validation']);
          return;
        }

        try {
          const result = await analyzeRecovery(evidence, {
            dolphin: this.options.dolphin,
            serv: this.options.serv,
            config: this.config,
          });
          let current: RecoveryEvidenceBundle;
          try {
            current = await this.buildEvidence(job.operation_id, job.actor);
          } catch {
            this.finish(jobId, 'stale', null, 'Operation evidence is no longer available for this actor', []);
            return;
          }
          if (current.evidenceHash !== evidence.evidenceHash) {
            this.finish(jobId, 'stale', null, 'Operation evidence changed before the assessment completed', ['Revalidate the operation and run the analysis again']);
            return;
          }
          const assessmentId = randomUUID(), created = iso();
          const usage = JSON.stringify({ dolphin: result.provider.dolphin.usage, serv: result.provider.serv.usage });
          const checkpointRevision = current.checkpoint?.proposalRevision ?? current.operation.revision;
          const liveRevision = current.live?.proposal?.revision ?? null;
          const liveProposalStage = current.live?.proposal?.stage ?? null;
          this.db.prepare(`INSERT INTO copilot_assessments
            (id,job_id,operation_id,actor,evidence_hash,evidence_json,assessment_json,validation_json,provider_json,checkpoint_sequence,operation_updated,verdict_code,checkpoint_revision,live_revision,live_proposal_stage,created)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
            assessmentId, jobId, job.operation_id, job.actor, evidence.evidenceHash, JSON.stringify(evidence),
            JSON.stringify(result.assessment), JSON.stringify({ valid: true, warnings: result.warnings }), JSON.stringify(result.provider),
            current.operation.sequence, current.operation.updated, current.verdict.code, checkpointRevision, liveRevision, liveProposalStage, created,
          );
          this.db.prepare("UPDATE copilot_jobs SET status='completed', assessment_id=?, updated=?, finished=?, usage_json=?, error=NULL, reasons=NULL WHERE id=?")
            .run(assessmentId, created, created, usage, jobId);
        } catch (error) {
          const code = error instanceof CopilotError ? error.code : 'provider_failure';
          const status: CopilotJobStatus = code === 'invalid_output' ? 'invalid' : 'failed';
          const reasons = error instanceof CopilotValidationError ? error.reasons : [];
          const message = error instanceof CopilotError ? error.message : 'Recovery analysis failed';
          this.finish(jobId, status, null, message, reasons);
        }
      });
    } catch (error) {
      if (error instanceof BusyError) return;
      throw error;
    }
  }

  private finish(jobId: string, status: CopilotJobStatus, assessmentId: string | null, error: string | null, reasons: string[]) {
    const finished = iso();
    this.db.prepare('UPDATE copilot_jobs SET status=?, assessment_id=?, error=?, reasons=?, updated=?, finished=? WHERE id=?')
      .run(status, assessmentId, error?.slice(0, 2000) ?? null, reasons.length ? JSON.stringify(reasons.slice(0, 20)) : null, finished, finished, jobId);
  }

  private jobRow(jobId: string): CopilotJobRow | undefined {
    return this.db.prepare('SELECT * FROM copilot_jobs WHERE id=?').get(jobId) as CopilotJobRow | undefined;
  }

  getJob(operationId: string, actor: string, jobId: string): JobResponse {
    this.participant(operationId, actor);
    const job = this.db.prepare('SELECT * FROM copilot_jobs WHERE id=? AND operation_id=? AND actor=?').get(jobId, operationId, actor) as CopilotJobRow | undefined;
    if (!job) throw new CopilotError('Copilot job not found', 404, 'not_found');
    return {
      jobId: job.id,
      status: job.status,
      assessmentId: job.assessment_id,
      evidenceHash: job.evidence_hash,
      error: job.error,
      reasons: parseReasons(job.reasons),
      attempts: job.attempts,
      createdAt: job.created,
      updatedAt: job.updated,
    };
  }

  listAssessments(operationId: string, actor: string, limit = 20): { assessments: AssessmentSummary[]; latest: AssessmentSummary | null } {
    this.participant(operationId, actor);
    const rows = this.db.prepare(
      'SELECT * FROM copilot_assessments WHERE operation_id=? AND actor=? ORDER BY created DESC LIMIT ?',
    ).all(operationId, actor, Math.max(1, Math.min(50, limit))) as CopilotAssessmentRow[];
    const assessments: AssessmentSummary[] = [];
    for (const row of rows) {
      try {
        const assessment = recoveryAssessmentSchema.parse(JSON.parse(row.assessment_json));
        assessments.push({
          id: row.id,
          createdAt: row.created,
          verdictCode: row.verdict_code,
          evidenceHash: row.evidence_hash,
          checkpointSequence: row.checkpoint_sequence,
          operationUpdated: row.operation_updated,
          summary: assessment.summary,
        });
      } catch { /* ignore a corrupted local record; it cannot become authoritative */ }
    }
    return { assessments, latest: assessments[0] ?? null };
  }

  getAssessment(operationId: string, actor: string, assessmentId: string) {
    const operation = this.participant(operationId, actor);
    const row = this.db.prepare(
      'SELECT * FROM copilot_assessments WHERE id=? AND operation_id=? AND actor=?',
    ).get(assessmentId, operationId, actor) as CopilotAssessmentRow | undefined;
    if (!row) throw new CopilotError('Copilot assessment not found', 404, 'not_found');
    let evidence: RecoveryEvidenceBundle;
    let assessment: RecoveryAssessment;
    try {
      evidence = recoveryEvidenceBundleSchema.parse(JSON.parse(row.evidence_json));
      assessment = recoveryAssessmentSchema.parse(JSON.parse(row.assessment_json));
    } catch {
      throw new CopilotError('Stored copilot assessment is not readable', 503, 'invalid_stored_assessment');
    }
    return {
      assessment,
      sources: sourceMap(evidence),
      provider: providerMetadataSchema.parse(JSON.parse(row.provider_json)),
      snapshot: {
        checkpointSequence: row.checkpoint_sequence,
        operationUpdated: row.operation_updated,
        verdictCode: row.verdict_code,
        checkpointRevision: row.checkpoint_revision,
        liveRevision: row.live_revision,
        liveProposalStage: row.live_proposal_stage,
      },
      createdAt: row.created,
      stale: row.checkpoint_sequence !== operation.sequence
        || row.operation_updated !== operation.updated
        || row.checkpoint_revision !== operation.revision,
    };
  }
}
