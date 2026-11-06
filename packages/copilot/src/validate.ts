import {
  recoveryAssessmentSchema,
  recoveryDraftSchema,
  type RecoveryAssessment,
  type RecoveryDraft,
  type RecoveryEvidenceBundle,
  type EvidenceSource,
} from './schemas.js';
import { sourceMap } from './evidence.js';

export type ValidationResult<T> =
  | { ok: true; value: T; warnings: string[] }
  | { ok: false; reasons: string[] };

const ADDRESS = /0x[0-9a-fA-F]{64}/g;
const HEX_64 = /\b[0-9a-fA-F]{64}\b/g;
const BASE58_DIGEST = /\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/g;

const blockedPatterns: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\b(auto(matic(ally)?)?[\s-]*(submit|sign|approve(d)?|resubmit|retry)|without (your |human |explicit )?(approval|review|signature)|implied approval|approval (is )?inferred)\b/i,
    reason: 'Proposes an automatic or inferred approval/transaction action',
  },
  {
    pattern: /\b(guarantee(d)?|risk-free|profit|refund|fee will be|gas will cost)\b/i,
    reason: 'Makes an unsupported fee, financial, or reliability promise',
  },
  {
    pattern: /\b(set|replace|change)\s+(the\s+)?successor\s+(to|with)\b/i,
    reason: 'Proposes an unsupported successor substitution',
  },
  {
    pattern: /\b(ignore|disregard|override)\b[^.]{0,60}\b(instruction|prompt|system|developer)\b/i,
    reason: 'Repeats prompt-injection style instructions',
  },
];

const actionVerb = /\b(sign|signing|submit|submitting|broadcast|broadcasting|resubmit|re-submit|retry the transaction)\b/i;
const negativeContext = /\b(do not|don't|never|avoid|without|must not|should not)\b/i;

const addUnique = (reasons: string[], reason: string) => {
  if (!reasons.includes(reason)) reasons.push(reason);
};

function checkIdentifiers(text: string, sources: EvidenceSource[], where: string, reasons: string[]) {
  const known = new Set(sources.map(source => source.value));
  for (const match of text.matchAll(ADDRESS)) {
    if (!known.has(match[0])) addUnique(reasons, `${where} cites an unknown Sui address: ${match[0]}`);
  }
  for (const match of text.matchAll(HEX_64)) {
    if (/^0x/i.test(match[0])) continue;
    if (!known.has(match[0])) addUnique(reasons, `${where} cites an unknown 64-character hash: ${match[0]}`);
  }
  for (const match of text.matchAll(BASE58_DIGEST)) {
    if (!known.has(match[0])) addUnique(reasons, `${where} cites an unknown transaction-like digest: ${match[0]}`);
  }
}

function checkText(text: string, where: string, evidence: RecoveryEvidenceBundle, reasons: string[]) {
  checkIdentifiers(text, evidence.sources, where, reasons);
  for (const blocked of blockedPatterns) {
    if (blocked.pattern.test(text)) addUnique(reasons, `${where}: ${blocked.reason}`);
  }
}

function checkSourceIds(ids: string[], sources: Map<string, EvidenceSource>, where: string, reasons: string[]) {
  if (ids.length === 0) {
    addUnique(reasons, `${where} has no source references`);
    return;
  }
  for (const id of ids) {
    if (!sources.has(id)) addUnique(reasons, `${where} cites unknown sourceId "${id}"`);
  }
}

function checkFindings(findings: RecoveryAssessment['findings'], sources: Map<string, EvidenceSource>, evidence: RecoveryEvidenceBundle, reasons: string[]) {
  findings.forEach((finding, index) => {
    const where = `findings[${index}]`;
    checkSourceIds(finding.sourceIds, sources, where, reasons);
    if (finding.status === 'verified' && finding.sourceIds.length === 0) {
      addUnique(reasons, `${where} is verified without evidence sources`);
    }
    checkText(finding.statement, where, evidence, reasons);
  });
}

function allowedStepKinds(evidence: RecoveryEvidenceBundle): Set<string> {
  const code = evidence.verdict.code;
  if (code === 'completed') return new Set(['inspect', 'wait']);
  if (code === 'memory_unavailable' || code === 'chain_unavailable') return new Set(['inspect', 'wait', 'revalidate']);
  if (code === 'ready') return new Set(['inspect', 'wait', 'review', 'revalidate', 'request_wallet_review']);
  return new Set(['inspect', 'wait', 'review', 'revalidate']);
}

function checkSteps(steps: RecoveryAssessment['steps'], evidence: RecoveryEvidenceBundle, sources: Map<string, EvidenceSource>, reasons: string[]) {
  const allowed = allowedStepKinds(evidence);
  const walletReviewAllowed = evidence.verdict.code === 'ready'
    && evidence.actor.role === 'successor'
    && evidence.verdict.nextAction === 'accept';

  steps.forEach((step, index) => {
    const where = `steps[${index}]`;
    checkSourceIds(step.sourceIds, sources, where, reasons);
    checkText(step.instruction, where, evidence, reasons);
    if (!allowed.has(step.kind)) {
      addUnique(reasons, `${where} uses step kind "${step.kind}" which the deterministic verdict does not permit`);
    }
    if (step.kind === 'request_wallet_review' && !walletReviewAllowed) {
      addUnique(reasons, `${where} requests wallet review although the deterministic verdict does not permit it`);
    }
    if (actionVerb.test(step.instruction) && !negativeContext.test(step.instruction) && step.kind !== 'request_wallet_review') {
      addUnique(reasons, `${where} recommends a transaction action outside wallet review`);
    }
  });
}

function schemaReasons(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string[] {
  return error.issues.slice(0, 20).map(issue => `${issue.path.map(String).join('.') || 'assessment'}: ${issue.message}`);
}

export function validateDraft(input: unknown, evidence: RecoveryEvidenceBundle): ValidationResult<RecoveryDraft> {
  const parsed = recoveryDraftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reasons: schemaReasons(parsed.error) };
  const draft = parsed.data;
  const reasons: string[] = [];
  if (draft.operationId !== evidence.operationId) addUnique(reasons, 'Draft operation does not match the evidence bundle');
  if (draft.evidenceHash !== evidence.evidenceHash) addUnique(reasons, 'Draft evidence hash does not match the current bundle');
  const sources = new Map(evidence.sources.map(source => [source.id, source]));
  checkText(draft.summary, 'summary', evidence, reasons);
  checkFindings(draft.findings, sources, evidence, reasons);
  draft.questions.forEach((question, index) => checkText(question, `questions[${index}]`, evidence, reasons));
  return reasons.length ? { ok: false, reasons } : { ok: true, value: draft, warnings: [] };
}

export function validateAssessment(input: unknown, evidence: RecoveryEvidenceBundle): ValidationResult<RecoveryAssessment> {
  const parsed = recoveryAssessmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reasons: schemaReasons(parsed.error) };
  const assessment = parsed.data;
  const reasons: string[] = [];
  if (assessment.operationId !== evidence.operationId) addUnique(reasons, 'Assessment operation does not match the evidence bundle');
  if (assessment.evidenceHash !== evidence.evidenceHash) addUnique(reasons, 'Assessment evidence hash does not match the current bundle');
  if (assessment.deterministicVerdict !== evidence.verdict.code) {
    addUnique(reasons, `Assessment verdict "${assessment.deterministicVerdict}" does not match deterministic verdict "${evidence.verdict.code}"`);
  }
  const sources = new Map(evidence.sources.map(source => [source.id, source]));
  checkText(assessment.summary, 'summary', evidence, reasons);
  checkFindings(assessment.findings, sources, evidence, reasons);
  assessment.questions.forEach((question, index) => checkText(question, `questions[${index}]`, evidence, reasons));
  checkSteps(assessment.steps, evidence, sources, reasons);
  return reasons.length ? { ok: false, reasons } : { ok: true, value: assessment, warnings: [] };
}

export function evidenceSourceMap(evidence: RecoveryEvidenceBundle) {
  return sourceMap(evidence);
}
