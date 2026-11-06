import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { fromBase64 } from '@mysten/sui/utils';

if (process.env.OPEN_SERV_E2E_CONFIRM !== 'yes') {
  console.error('Refusing to run testnet E2E without OPEN_SERV_E2E_CONFIRM=yes');
  process.exit(2);
}

const root = process.cwd();
const base = 'http://127.0.0.1:4411';
const origin = 'http://127.0.0.1:4410';
const keysPath = join(root, '.data', 'openserv-e2e-keys.json');
if (!existsSync(keysPath)) throw new Error('Missing .data/openserv-e2e-keys.json; fund the burner test wallets first');

type StoredKeys = { admin: string; successor: string; alternate: string };
const stored = JSON.parse(readFileSync(keysPath, 'utf8')) as StoredKeys;
const wallets = {
  admin: Ed25519Keypair.fromSecretKey(stored.admin),
  successor: Ed25519Keypair.fromSecretKey(stored.successor),
  alternate: Ed25519Keypair.fromSecretKey(stored.alternate),
};

type Prep = { id: string; operationId: string | null; bytes: string; digest: string; state: string };
type View = {
  operation: { id: string; successor: string; administrator: string; sequence: number; updated: string; revision: string };
  checkpoint: { successor: string; proposalRevision: string; stage: string } | null;
  live: { proposal: { stage: number; successor: string } | null; control: { administrator: string; counter: string } } | null;
  verdict: { code: string; message: string; nextAction?: string };
  journal: unknown[];
  preference: unknown;
};

type ApiResult<T> = { value: T; headers: Headers; status: number };

async function api<T = unknown>(method: string, path: string, options: { cookie?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(method === 'POST' ? { origin, 'content-type': 'application/json' } : {}),
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  let value: unknown;
  try { value = text ? JSON.parse(text) : undefined; } catch { value = text; }
  if (!response.ok) {
    const error = value as { error?: string; code?: string } | undefined;
    throw new Error(`${method} ${path} failed (${response.status})${error?.error ? `: ${error.error}` : ''}${error?.code ? ` [${error.code}]` : ''}`);
  }
  return { value: value as T, headers: response.headers, status: response.status };
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function until<T>(label: string, work: () => Promise<T | undefined | null | false>, timeoutMs = 180_000): Promise<T> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await work();
      if (value) return value;
    } catch (error) { lastError = error; }
    await sleep(2000);
  }
  throw new Error(`${label} timed out${lastError instanceof Error ? `: ${lastError.message}` : ''}`);
}

async function login(keypair: Ed25519Keypair) {
  const actor = keypair.toSuiAddress();
  const challenge = (await api<{ id: string; message: string }>('POST', '/api/auth/challenge', { body: { actor } })).value;
  const signed = await keypair.signPersonalMessage(new TextEncoder().encode(challenge.message));
  const verified = await api<{ actor: string }>('POST', '/api/auth/verify', { body: { id: challenge.id, signature: signed.signature } });
  const cookie = verified.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Authentication did not return a session cookie');
  return { actor, cookie };
}

async function submit(prep: Prep, keypair: Ed25519Keypair, cookie: string) {
  const signed = await keypair.signTransaction(fromBase64(prep.bytes));
  const result = await api<{ status: string; operationId?: string; digest?: string }>('POST', '/api/transactions/submit', {
    cookie, body: { id: prep.id, bytes: signed.bytes, signature: signed.signature },
  });
  if (['chain_confirmed_memory_pending', 'unresolved', 'submitting'].includes(result.value.status)) {
    try { await api('POST', `/api/preparations/${prep.id}/recover`, { cookie, body: {} }); } catch { /* poll below */ }
  }
  return result.value;
}

async function setup(action: 'publish' | 'create' | 'increment', control: string | undefined, keypair: Ed25519Keypair, cookie: string) {
  let prep: Prep | undefined;
  for (let attempt = 0; attempt < 90 && !prep; attempt++) {
    try {
      prep = (await api<Prep>('POST', '/api/setup/prepare', { cookie, body: { action, ...(control ? { control } : {}) } })).value;
    } catch (error) {
      if (error instanceof Error && /Another worker is verifying/.test(error.message)) { await sleep(2000); continue; }
      throw error;
    }
  }
  if (!prep) throw new Error(`setup ${action} could not acquire its lease`);
  const result = await submit(prep, keypair, cookie);
  await until(`setup ${action} finalize`, async () => {
    const list = (await api<{ preparations: Array<{ id: string }> }>('GET', '/api/preparations', { cookie })).value;
    return list.preparations.some(item => item.id === prep.id) ? undefined : true;
  }, 240_000);
  return result;
}

async function prepareOperation(id: string, action: string, cookie: string, successor?: string) {
  return (await api<Prep>('POST', `/api/operations/${id}/prepare-${action}`, {
    cookie, body: action === 'change_successor' ? { successor } : {},
  })).value;
}

async function view(id: string, cookie: string) {
  return (await api<View>('GET', `/api/operations/${id}`, { cookie })).value;
}

async function analyzeRobust(id: string, cookie: string, label: string) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await analyze(id, cookie); }
    catch (error) {
      if (attempt === 3) throw error;
      stage(`${label}-retry`, { attempt, error: error instanceof Error ? error.message : 'failed' });
      await sleep(3000);
    }
  }
  throw new Error(`${label} failed`);
}

async function analyze(id: string, cookie: string) {
  const queued = (await api<{ jobId: string; status: string; assessmentId: string | null }>('POST', `/api/operations/${id}/copilot/assess`, {
    cookie, body: { approved: true },
  })).value;
  let job = queued;
  if (queued.status !== 'completed') {
    job = await until('copilot job', async () => {
      const current = (await api<{ jobId: string; status: string; assessmentId: string | null; error: string | null; reasons: string[] }>(
        'GET', `/api/operations/${id}/copilot/jobs/${queued.jobId}`, { cookie },
      )).value;
      return ['completed', 'failed', 'invalid', 'stale'].includes(current.status) ? current : undefined;
    }, 240_000);
  }
  if (job.status !== 'completed' || !job.assessmentId) {
    const failed = job as { status: string; error?: string | null; reasons?: string[] };
    throw new Error(`Copilot job ${failed.status}${failed.error ? `: ${failed.error}` : ''}${failed.reasons?.length ? ` (${failed.reasons.join('; ')})` : ''}`);
  }
  const assessment = (await api<Record<string, unknown>>('GET', `/api/operations/${id}/copilot/assessments/${job.assessmentId}`, { cookie })).value;
  return { jobId: job.jobId, assessmentId: job.assessmentId, assessment };
}

let child: ChildProcess | undefined;
const stages: Array<{ name: string; at: string; value: unknown }> = [];
const results: Record<string, unknown> = { fixtureOnly: false, network: 'testnet', stages };
function stage(name: string, value: unknown) {
  stages.push({ name, at: new Date().toISOString(), value });
  console.log(JSON.stringify({ stage: name, value }));
}

try {
  for (const suffix of ['.sqlite', '.sqlite-shm', '.sqlite-wal']) {
    try { rmSync(join(root, '.data', `janus-openserv-e2e${suffix}`), { force: true }); } catch { /* ignore */ }
  }
  try { rmSync(join(root, '.data', 'openserv-e2e-writer.pem'), { force: true }); } catch { /* ignore */ }

  const out = join(root, '.data', 'openserv-e2e-api.log');
  const err = join(root, '.data', 'openserv-e2e-api.err.log');
  child = spawn(process.execPath, ['--env-file-if-exists=.env', '--import', 'tsx', 'apps/api/src/server.ts'], {
    cwd: root,
    env: {
      ...process.env,
      JANUS_DATABASE_PATH: '.data/janus-openserv-e2e.sqlite',
      JANUS_WRITER_KEY_PATH: '.data/openserv-e2e-writer.pem',
      WALRUS_MEMORY_NAMESPACE: 'janus-openserv-e2e',
      WALRUS_MEMORY_RECORD_PREFIX: 'janus-openserv-e2e-record',
      JANUS_PORT: '4411',
      JANUS_RUNTIME_ORIGIN: origin,
      JANUS_ALLOWED_ORIGINS: origin,
      COPILOT_ENABLED: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stdout?.on('data', chunk => writeFileSync(out, String(chunk), { flag: 'a' }));
  child.stderr?.on('data', chunk => { stderr += String(chunk); writeFileSync(err, String(chunk), { flag: 'a' }); });

  await until('test API startup', async () => {
    if (child?.exitCode !== null) throw new Error(`test API exited (${child?.exitCode}): ${stderr.slice(-500)}`);
    try { await api('GET', '/api/config'); return true; } catch { return false; }
  }, 120_000);
  stage('isolated-api-ready', { port: '4411', database: '.data/janus-openserv-e2e.sqlite', namespace: 'janus-openserv-e2e-record' });

  const admin = await login(wallets.admin);
  const successor = await login(wallets.successor);
  const alternate = await login(wallets.alternate);
  stage('wallet-auth', { admin: admin.actor, successor: successor.actor, alternate: alternate.actor, role: 'three disposable testnet wallets' });

  await setup('publish', undefined, wallets.admin, admin.cookie);
  const config = await until('package publication', async () => {
    const value = (await api<{ packageId: string | null }>('GET', '/api/config')).value;
    return value.packageId ? value : undefined;
  }, 240_000);
  stage('package-published', { packageId: config.packageId });

  await setup('create', undefined, wallets.admin, admin.cookie);
  const control = await until('control creation', async () => {
    const value = (await api<{ controls: Array<{ id: string }> }>('GET', '/api/controls', { cookie: admin.cookie })).value;
    return value.controls[0];
  }, 240_000);
  stage('control-created', { control: control.id });

  const created = (await api<{ id: string; preparation: Prep }>('POST', '/api/operations', {
    cookie: admin.cookie,
    body: {
      label: 'OpenServ isolated testnet handover',
      control: control.id,
      successor: alternate.actor,
      expiresAtMs: String(Date.now() + 3_600_000),
      public: false,
    },
  })).value;
  await submit(created.preparation, wallets.admin, admin.cookie);
  const proposed = await until('proposal verification', async () => {
    const value = await view(created.id, admin.cookie);
    return value.live?.proposal?.stage === 1 ? value : undefined;
  }, 240_000);
  stage('operation-proposed', { operationId: created.id, verdict: proposed.verdict.code, journalEntries: proposed.journal.length });

  await submit(await prepareOperation(created.id, 'change_successor', admin.cookie, successor.actor), wallets.admin, admin.cookie);
  const mismatch = await until('successor mismatch', async () => {
    const value = await view(created.id, admin.cookie);
    return value.verdict.code === 'mismatch' ? value : undefined;
  }, 240_000);
  stage('successor-mismatch-detected', { verdict: mismatch.verdict.code });
  await api('POST', `/api/operations/${created.id}/approve-live`, { cookie: admin.cookie, body: { approve: true } });
  const changed = await until('successor change approval', async () => {
    const value = await view(created.id, admin.cookie);
    return value.checkpoint?.successor === successor.actor ? value : undefined;
  }, 240_000);
  stage('successor-changed', { verdict: changed.verdict.code, successor: successor.actor });

  const successorView = await until('successor ready', async () => {
    const value = await view(created.id, successor.cookie);
    return value.verdict.code === 'ready' ? value : undefined;
  }, 120_000);
  stage('successor-ready', { verdict: successorView.verdict.code, nextAction: successorView.verdict.nextAction });

  const successorAssessment = await analyzeRobust(created.id, successor.cookie, 'copilot-ready');
  const successorSteps = (successorAssessment.assessment.assessment as { steps?: Array<{ kind: string }> })?.steps ?? [];
  stage('copilot-successor-assessment', {
    assessmentId: successorAssessment.assessmentId,
    verdict: (successorAssessment.assessment.assessment as { deterministicVerdict?: string })?.deterministicVerdict,
    stepKinds: successorSteps.map(step => step.kind),
  });

  await submit(await prepareOperation(created.id, 'accept', successor.cookie), wallets.successor, successor.cookie);
  const completed = await until('acceptance verification', async () => {
    const value = await view(created.id, successor.cookie);
    return value.verdict.code === 'completed' ? value : undefined;
  }, 240_000);
  stage('handover-completed', { verdict: completed.verdict.code, checkpointStage: completed.checkpoint?.stage });

  const stale = (await api<{ stale: boolean }>('GET', `/api/operations/${created.id}/copilot/assessments/${successorAssessment.assessmentId}`, { cookie: successor.cookie })).value;
  stage('stale-assessment-detected', { stale: stale.stale });

  const completedAssessment = await analyzeRobust(created.id, successor.cookie, 'copilot-completed');
  const completedSteps = (completedAssessment.assessment.assessment as { steps?: Array<{ kind: string }> })?.steps ?? [];
  stage('copilot-completed-assessment', {
    assessmentId: completedAssessment.assessmentId,
    verdict: (completedAssessment.assessment.assessment as { deterministicVerdict?: string })?.deterministicVerdict,
    stepKinds: completedSteps.map(step => step.kind),
    hasWalletReview: completedSteps.some(step => step.kind === 'request_wallet_review'),
  });

  await setup('increment', control.id, wallets.successor, successor.cookie);
  const counter = await until('counter increment', async () => {
    const value = (await api<{ counter: string }>('GET', `/api/controls/${control.id}`)).value;
    return value.counter !== '0' ? value : undefined;
  }, 180_000);
  stage('admin-counter', { counter: counter.counter });

  await api('POST', '/api/preferences', { cookie: successor.cookie, body: { approved: true, revoked: false, reviewStyle: 'concise' } });
  const preference = await until('preference read', async () => {
    const value = (await api<{ preference: { reviewStyle?: string } | null }>('GET', '/api/preferences', { cookie: successor.cookie })).value;
    return value.preference ? value : undefined;
  }, 180_000);
  stage('preference-roundtrip', { reviewStyle: preference.preference?.reviewStyle });

  const memories = (await api<{ memories: Array<{ id: string; ref: string }> }>('GET', '/api/memories', { cookie: successor.cookie })).value;
  const firstMemory = memories.memories[0];
  if (!firstMemory) throw new Error('No memory records were listed after the live flow');
  const memoryDetail = (await api<{ ref: { namespace: string } }>('GET', `/api/memories/${firstMemory.id}`, { cookie: successor.cookie })).value;
  stage('memory-roundtrip', {
    recordsListed: memories.memories.length,
    newestNamespace: memoryDetail.ref.namespace,
    isolatedNamespace: memoryDetail.ref.namespace.startsWith('janus-openserv-e2e-record-'),
  });

  const reference = (await api<{ ref: { namespace: string } }>('GET', `/api/operations/${created.id}/recovery-reference`, { cookie: successor.cookie })).value;
  stage('recovery-reference', { namespace: reference.ref.namespace, isolatedNamespace: reference.ref.namespace.startsWith('janus-openserv-e2e-record-') });

  const second = (await api<{ id: string; preparation: Prep }>('POST', '/api/operations', {
    cookie: successor.cookie,
    body: {
      label: 'OpenServ cancel fixture handover',
      control: control.id,
      successor: admin.actor,
      expiresAtMs: String(Date.now() + 3_600_000),
      public: false,
    },
  })).value;
  await submit(second.preparation, wallets.successor, successor.cookie);
  await until('second proposal', async () => {
    const value = await view(second.id, successor.cookie);
    return value.live?.proposal?.stage === 1 ? value : undefined;
  }, 240_000);
  await submit(await prepareOperation(second.id, 'cancel', successor.cookie), wallets.successor, successor.cookie);
  const cancelled = await until('cancellation', async () => {
    const value = await view(second.id, successor.cookie);
    return value.verdict.code === 'cancelled' ? value : undefined;
  }, 240_000);
  stage('cancellation', { operationId: second.id, verdict: cancelled.verdict.code });

  results.ok = true;
  results.testWallets = { admin: admin.actor, successor: successor.actor, alternate: alternate.actor };
  results.note = 'Disposable Sui testnet wallets. Test-only Walrus records use the janus-openserv-e2e-record prefix and cannot necessarily be deleted.';
  writeFileSync(join(root, '.data', 'openserv-e2e-results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ ok: true, resultFile: '.data/openserv-e2e-results.json' }, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : 'E2E failed';
  results.ok = false;
  results.error = message;
  try { writeFileSync(join(root, '.data', 'openserv-e2e-results.json'), JSON.stringify(results, null, 2)); } catch { /* ignore */ }
  console.error(JSON.stringify({ ok: false, error: message, stages: results.stages }, null, 2));
  const err = join(root, '.data', 'openserv-e2e-api.err.log');
  if (existsSync(err)) console.error(readFileSync(err, 'utf8').slice(-2000));
  process.exitCode = 1;
} finally {
  if (child) {
    child.kill('SIGTERM');
    await sleep(3000);
    if (child.exitCode === null) {
      try { process.kill(child.pid!, 'SIGKILL'); } catch { /* ignore */ }
    }
  }
}
