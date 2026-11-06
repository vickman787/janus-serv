import { useEffect, useMemo, useRef, useState } from 'react';
import type { AssessmentResponse, AssessmentSummary, AssessmentSnapshot, CopilotJobStatus, JobResponse, RecoveryAssessment } from '../../../../packages/copilot/src/schemas.js';
import type { CopilotCapabilities } from '../../../../packages/copilot/src/config.js';

type CopilotView = {
  operation: { id: string; sequence: number; updated: string; revision: string; administrator: string; successor: string; status: string };
  checkpoint: { stage: string; proposalRevision: string } | null;
  live: { fetchedAt: string; proposal: { stage: number; revision: string } | null } | null;
  verdict: { code: string; message: string; differences: unknown[] };
};

type EnqueueResult = { jobId: string; status: CopilotJobStatus; assessmentId: string | null; evidenceHash: string; deduplicated: boolean };

type Props = {
  operationId: string;
  actor?: string;
  participant: boolean;
  view: CopilotView;
  capabilities?: CopilotCapabilities;
  onRevalidate: () => Promise<void> | void;
};

async function api<T>(path: string, data?: unknown): Promise<T> {
  const response = await fetch('/api' + path, {
    method: data === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    ...(data === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }),
  });
  const value = await response.json();
  if (!response.ok) {
    if (response.status === 401) dispatchEvent(new Event('janus-session-expired'));
    throw Object.assign(new Error(value.error ?? 'Request failed'), { code: value.code });
  }
  return value as T;
}

const when = (value?: string | null) => value
  ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : '—';
const title = (value: string) => value.replaceAll('_', ' ');
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function SourceList({ ids, sources }: { ids: string[]; sources: AssessmentResponse['sources'] }) {
  if (!ids.length) return null;
  return <div className="copilot-sources">
    <span className="eyebrow">SOURCE EVIDENCE</span>
    <ul>{ids.map(id => {
      const source = sources[id];
      return <li key={id}>
        <strong>{source?.label ?? id}</strong>
        <code className="copilot-source-value">{source?.value || 'Source unavailable'}</code>
        {source?.untrusted && <small>Untrusted operation text; treated as data.</small>}
      </li>;
    })}</ul>
  </div>;
}

function Findings({ assessment, sources }: { assessment: RecoveryAssessment; sources: AssessmentResponse['sources'] }) {
  const verified = assessment.findings.filter(finding => finding.status === 'verified');
  const uncertain = assessment.findings.filter(finding => finding.status !== 'verified');
  return <div className="copilot-findings">
    <div>
      <h3>Verified from evidence</h3>
      {verified.length ? <ul>{verified.map((finding, index) => <li key={index}>
        <p>{finding.statement}</p>
        <SourceList ids={finding.sourceIds} sources={sources} />
      </li>)}</ul> : <p>No mechanically source-backed findings were returned.</p>}
    </div>
    <div>
      <h3>Uncertain or interpretation</h3>
      {uncertain.length ? <ul>{uncertain.map((finding, index) => <li key={index}>
        <p>{finding.statement}</p>
        <SourceList ids={finding.sourceIds} sources={sources} />
      </li>)}</ul> : <p>No uncertain findings were returned.</p>}
    </div>
  </div>;
}

export function RecoveryCopilot({ operationId, actor, participant, view, capabilities, onRevalidate }: Props) {
  const [latest, setLatest] = useState<AssessmentResponse>();
  const [history, setHistory] = useState<AssessmentSummary[]>([]);
  const [job, setJob] = useState<JobResponse>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const cancelled = useRef(false);

  const stale = useMemo(() => {
    if (!latest) return false;
    if (latest.stale) return true;
    const snapshot: AssessmentSnapshot = latest.snapshot;
    const checkpointRevision = view.checkpoint?.proposalRevision ?? view.operation.revision;
    return snapshot.checkpointSequence !== view.operation.sequence
      || snapshot.operationUpdated !== view.operation.updated
      || snapshot.verdictCode !== view.verdict.code
      || snapshot.checkpointRevision !== checkpointRevision
      || snapshot.liveRevision !== (view.live?.proposal?.revision ?? null)
      || snapshot.liveProposalStage !== (view.live?.proposal?.stage ?? null);
  }, [latest, view.operation.sequence, view.operation.updated, view.operation.revision, view.verdict.code, view.checkpoint?.proposalRevision, view.live?.proposal?.revision, view.live?.proposal?.stage]);

  const polling = !!job && (job.status === 'queued' || job.status === 'running');

  async function loadList() {
    if (!participant || !actor) return;
    const result = await api<{ assessments: AssessmentSummary[]; latest: AssessmentSummary | null }>(`/operations/${operationId}/copilot/assessments`);
    if (cancelled.current) return;
    setHistory(result.assessments);
    if (result.latest) {
      const response = await api<AssessmentResponse>(`/operations/${operationId}/copilot/assessments/${result.latest.id}`);
      if (!cancelled.current) setLatest(response);
    }
  }

  async function loadAssessment(assessmentId: string) {
    const response = await api<AssessmentResponse>(`/operations/${operationId}/copilot/assessments/${assessmentId}`);
    if (!cancelled.current) setLatest(response);
  }

  useEffect(() => {
    cancelled.current = false;
    setLatest(undefined); setHistory([]); setJob(undefined); setMessage(''); setError('');
    if (!participant || !actor) return;
    setLoading(true);
    loadList().catch(value => { if (!cancelled.current) setError(value instanceof Error ? value.message : 'Assessment history unavailable'); })
      .finally(() => { if (!cancelled.current) setLoading(false); });
    return () => { cancelled.current = true; };
  }, [operationId, actor, participant]);

  useEffect(() => {
    if (!job || (job.status !== 'queued' && job.status !== 'running')) return;
    let active = true;
    const poll = async () => {
      for (let attempt = 0; attempt < 80 && active; attempt++) {
        try {
          const next = await api<JobResponse>(`/operations/${operationId}/copilot/jobs/${job.jobId}`);
          if (!active) return;
          setJob(next);
          if (next.status === 'completed' && next.assessmentId) {
            await loadAssessment(next.assessmentId);
            await loadList();
            setMessage('Advisory assessment completed. The deterministic verdict is unchanged.');
            return;
          }
          if (next.status === 'failed' || next.status === 'invalid' || next.status === 'stale') {
            setError([next.error ?? 'Analysis did not complete', ...next.reasons].filter(Boolean).join(' — '));
            return;
          }
        } catch (value) {
          if (!active) return;
          setError(value instanceof Error ? value.message : 'Analysis status unavailable');
          return;
        }
        await sleep(1200);
      }
      if (active) setError('Analysis is taking longer than expected. Check provider configuration before retrying.');
    };
    void poll();
    return () => { active = false; };
  }, [job?.jobId, job?.status, operationId]);

  async function analyze() {
    setBusy(true); setError(''); setMessage('Queued advisory analysis. Evidence is minimized before provider calls.');
    try {
      const result = await api<EnqueueResult>(`/operations/${operationId}/copilot/assess`, { approved: true });
      if (result.status === 'completed' && result.assessmentId) {
        await loadAssessment(result.assessmentId);
        await loadList();
        setMessage('Existing advisory assessment reused; no duplicate provider call was made.');
        return;
      }
      const next = await api<JobResponse>(`/operations/${operationId}/copilot/jobs/${result.jobId}`);
      setJob(next);
      if (result.deduplicated) setMessage('Existing copilot job reused for this evidence version.');
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Analysis could not be queued');
    } finally {
      setBusy(false);
    }
  }

  async function revalidate() {
    setBusy(true); setError('');
    try {
      await onRevalidate();
      await loadList();
      setMessage('Operation evidence revalidated. Reanalyze if the advisory assessment is now stale.');
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Revalidation failed');
    } finally {
      setBusy(false);
    }
  }

  const providerLabel = latest
    ? `${latest.provider.dolphin.label} (${latest.provider.dolphin.model}) → ${latest.provider.serv.label} (${latest.provider.serv.model})`
    : capabilities ? `${capabilities.provider} · ${capabilities.dolphinModel} → ${capabilities.servModel}` : 'Dolphin Network + SERV Reasoning';

  return <section className="copilot" aria-labelledby="copilot-title">
    <div className="section-heading">
      <div>
        <div className="eyebrow">ADVISORY / RECOVERY COPILOT</div>
        <h2 id="copilot-title">Recovery Copilot</h2>
      </div>
      <span className={`state ${latest ? (stale ? 'copilot-stale' : 'copilot-ready') : ''}`}>{latest ? (stale ? 'stale' : 'advisory') : capabilities?.enabled ? 'ready' : 'disabled'}</span>
    </div>
    <p>{capabilities?.disclosure ?? 'Recovery Copilot is not configured. No evidence is sent to model providers.'}</p>

    {!participant ? <div className="empty">Connect and authenticate as the administrator or successor to request an advisory recovery assessment.</div> : !capabilities?.enabled ? <div className="notice" role="status">
      <strong>Copilot unavailable.</strong> {capabilities?.reason ?? 'Provider credentials are not configured.'} The deterministic cockpit and wallet flow remain available.
    </div> : <>
      <div className="copilot-controls">
        <button disabled={busy || polling || !actor} onClick={() => void analyze()}>{busy ? 'Queueing…' : polling ? 'Analyzing…' : latest ? 'Reanalyze recovery' : 'Analyze recovery'}</button>
        {latest && <button className="secondary" disabled={busy || polling} onClick={() => void analyze()}>Retry analysis</button>}
        {(stale || (job && ['failed', 'invalid', 'stale'].includes(job.status))) && <button className="secondary" disabled={busy || polling} onClick={() => void revalidate()}>Revalidate operation</button>}
      </div>
      <p className="copilot-scope">Provider calls use a source-labeled evidence bundle. They never receive wallet keys, session cookies, unsigned transaction bytes, raw memory envelopes, or signing payloads. Only the administrator and successor can retrieve this operation's assessments.</p>
      <div role="status" aria-live="polite">
        {message && <div className="notice">{message}</div>}
        {error && <div role="alert" className="error">{error}</div>}
        {loading && <div className="notice">Loading previous advisory assessments…</div>}
      </div>

      {stale && latest && <div className="copilot-stale-banner" role="alert">
        <strong>This assessment is stale.</strong> The operation evidence changed after analysis. Revalidate and reanalyze before relying on it. The deterministic verdict and wallet-review requirements below remain authoritative.
      </div>}

      {latest && <article className="copilot-assessment">
        <div className="copilot-advisory"><strong>Advisory assessment</strong><span>Model analysis cannot grant signing permission, override the verdict, or submit a transaction.</span></div>
        <h3>{latest.assessment.summary}</h3>
        <p className="copilot-meta">Providers: {providerLabel}<br/>Assessment: {when(latest.createdAt)} · Deterministic verdict at analysis: <span className="state">{title(latest.assessment.deterministicVerdict)}</span> · Prompt {latest.provider.dolphin.promptVersion}</p>

        <Findings assessment={latest.assessment} sources={latest.sources} />

        <div className="copilot-steps">
          <h3>Proposed review steps</h3>
          {latest.assessment.steps.length ? <ol>{latest.assessment.steps.map((step, index) => <li key={index}>
            <span className="state">{title(step.kind)}</span>
            <p>{step.instruction}</p>
            <SourceList ids={step.sourceIds} sources={latest.sources} />
          </li>)}</ol> : <p>No steps were proposed. Continue from the deterministic verdict.</p>}
        </div>

        <div className="copilot-questions">
          <h3>Still unresolved</h3>
          {latest.assessment.questions.length ? <ul>{latest.assessment.questions.map((question, index) => <li key={index}>{question}</li>)}</ul> : <p>No open questions were returned.</p>}
        </div>

        <p className="copilot-footnote">Analysis time uses server time. Provider usage: Dolphin {latest.provider.dolphin.usage.totalTokens ?? '—'} tokens · SERV {latest.provider.serv.usage.totalTokens ?? '—'} tokens. Model output is not a substitute for fresh chain and memory evidence.</p>
      </article>}

      {history.length > 1 && <details className="copilot-history">
        <summary>Previous advisory assessments ({history.length})</summary>
        <ul>{history.map(item => <li key={item.id}>
          <button className="text-button" disabled={busy || polling} onClick={() => void loadAssessment(item.id).catch(value => setError(value instanceof Error ? value.message : 'Assessment unavailable'))}>{when(item.createdAt)} · {title(item.verdictCode)}</button>
          <p>{item.summary}</p>
        </li>)}</ul>
      </details>}
    </>}
  </section>;
}
