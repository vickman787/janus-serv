import { serveWeb } from './static.js';
import { Store, BusyError } from './store.js';
import { Engine, WorkflowError } from './engine.js';
import { applicationRoutes } from './routes.js';
import { ChainAdapter, ZERO } from '../../../packages/chain/src/handover.js';
import { MemoryAdapter } from '../../../packages/memory/src/adapter.js';
import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { Transaction } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/sui/utils';
import { createTatumClient, isProviderRateLimit } from '../../../packages/chain/src/tatum.js';
import { createMemoryClient } from '../../../packages/memory/src/client.js';
import { verifyApprovedBytes } from '../../../packages/chain/src/approved-bytes.js';
import { AuthStore, AuthError } from './auth.js';
import { CopilotError } from '../../../packages/copilot/src/errors.js';
import { CopilotService } from '../../../packages/copilot/src/analyze.js';
import { copilotConfigFromEnv } from '../../../packages/copilot/src/config.js';
import { DolphinProvider } from '../../../packages/copilot/src/dolphin.js';
import { ServProvider } from '../../../packages/copilot/src/serv.js';

const network = z.literal('testnet').parse(process.env.SUI_NETWORK ?? 'testnet');
const origin = process.env.JANUS_RUNTIME_ORIGIN ?? 'http://localhost:4310';
const runtimeUrl = new URL(origin);
if (runtimeUrl.origin !== origin) throw new Error('JANUS_RUNTIME_ORIGIN must be a canonical origin without a path');
const allowedOrigins = new Set([origin, ...(process.env.JANUS_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean)]);
for (const allowed of allowedOrigins) {
  const parsed = new URL(allowed);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== allowed) throw new Error(`Invalid allowed origin: ${allowed}`);
}
const port = Number(process.env.JANUS_PORT ?? '4311');
const databasePath = process.env.JANUS_DATABASE_PATH?.trim() || '.data/janus-openserv.sqlite';
if (!/^\.data\/[A-Za-z0-9._-]+\.sqlite$/.test(databasePath)) throw new Error('JANUS_DATABASE_PATH must be a .sqlite file directly under .data/');
const writerKeyPath = process.env.JANUS_WRITER_KEY_PATH?.trim() || '.data/openserv-writer-private.pem';
if (!/^\.data\/[A-Za-z0-9._-]+\.pem$/.test(writerKeyPath)) throw new Error('JANUS_WRITER_KEY_PATH must be a .pem file directly under .data/');
const recordPrefix = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Invalid WALRUS_MEMORY_RECORD_PREFIX').parse(process.env.WALRUS_MEMORY_RECORD_PREFIX ?? 'janus-openserv-record');
mkdirSync('.data', { recursive: true });
const db = new DatabaseSync(databasePath);

const { client, close } = createTatumClient();
const auth = new AuthStore(db, origin, network, { client });
const memory = createMemoryClient();
const store = new Store(db);
const storedPackage = db.prepare('SELECT value FROM config WHERE key=?').get('packageId') as {value:string}|undefined;
const engine = new Engine(store, new ChainAdapter(client, storedPackage?.value ?? (process.env.JANUS_PACKAGE_ID || ZERO)), new MemoryAdapter(memory, writerKeyPath,Number((db.prepare('SELECT COUNT(*) AS count FROM memories').get() as {count:number}).count)===0,recordPrefix));
const copilotSettings = copilotConfigFromEnv();
const copilot = new CopilotService({
  store, engine,
  dolphin: new DolphinProvider(copilotSettings.config.dolphin),
  serv: new ServProvider(copilotSettings.config.serv),
  config: copilotSettings.config,
  capabilities: copilotSettings.capabilities,
});
copilot.recoverInterrupted();
let copilotActive = false;
const copilotTimer = copilotSettings.config.enabled
  ? setInterval(async()=>{if(copilotActive)return;copilotActive=true;try{await copilot.tick();}catch{}finally{copilotActive=false;}},4000)
  : undefined;
const appRoutes = applicationRoutes(engine, session, req=>auth.actor(token(req)), req=>auth.hash(token(req)), body, reply, copilot);
let workerActive = false;
const workerTimer = setInterval(async()=>{if(workerActive)return;workerActive=true;try{await engine.tick();}catch{}finally{workerActive=false;}},20000);
const walletAddress = z.string().regex(/^0x[0-9a-f]{64}$/);
const limits = new Map<string, { count: number; expires: number }>();
let healthCache: { at: number; value: unknown } | undefined;
let healthPending: Promise<unknown> | undefined;
function reply(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(data));
}
async function body(req: IncomingMessage): Promise<unknown> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new AuthError('Expected JSON');
  let text = '';
  for await (const chunk of req) {
    text += String(chunk);
    if (Buffer.byteLength(text) > 262_144) throw new AuthError('Request too large');
  }
  try { return JSON.parse(text); } catch { throw new AuthError('Invalid JSON'); }
}
function token(req: IncomingMessage) { return req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('janus_session='))?.slice(14) ?? ''; }
function session(req: IncomingMessage) {
  const actor = auth.actor(token(req));
  if (!actor) throw new AuthError('Authenticate your connected wallet first');
  return actor;
}
async function health() {
  if (healthCache && Date.now() - healthCache.at < 30_000) return healthCache.value;
  if (healthPending) return healthPending;
  healthPending = (async () => {
    const [chainResult, memoryResult] = await Promise.allSettled([
      client.ledgerService.getCheckpoint({ checkpointId: { oneofKind: undefined }, readMask: { paths: ['sequence_number'] } }),
      memory.listMemories({ limit: 1 }),
    ]);
    const value = { network, memoryNetwork: process.env.WALRUS_MEMORY_NETWORK ?? 'mainnet', fetchedAt: new Date().toISOString(),
      tatum: chainResult.status === 'fulfilled' ? { status: 'verified', checkpoint: chainResult.value.response.checkpoint?.sequenceNumber?.toString() } : { status: 'unavailable' },
      walrus: memoryResult.status === 'fulfilled' ? { status: 'authenticated' } : { status: 'unavailable' },
      copilot: copilot.capabilities(),
      worker: { status: 'running_with_api', heartbeat: (db.prepare('SELECT value FROM config WHERE key=?').get('workerHeartbeat') as {value:string}|undefined)?.value ?? null }, package: { status: engine.chain.packageId===ZERO?'not_published':'configured', id: engine.chain.packageId===ZERO?null:engine.chain.packageId, compiled: (existsSync('.data/package.json')||existsSync('contracts/janus_handover/compiled/package.json')) } };
    healthCache = { at: Date.now(), value }; return value;
  })();
  try { return await healthPending; } finally { healthPending = undefined; }
}
const server = createServer(async (req, res) => {
  try {
    if (![runtimeUrl.host, 'localhost:'+port, '127.0.0.1:'+port].includes(req.headers.host ?? '')) return reply(res, 403, { error: 'Unsupported host' });
    const key = (req.socket.remoteAddress ?? 'local')+':'+(req.method==='POST'?'write':'read');
    const now = Date.now();
    for (const [k, v] of limits) if (v.expires <= now) limits.delete(k);
    const quota = limits.get(key) ?? { count: 0, expires: now + 60_000 }; quota.count++; limits.set(key, quota);
    if (quota.count > (req.method==='POST'?60:240)) return reply(res, 429, { error: 'Too many requests; wait a minute' });
    if (req.method === 'POST' && !allowedOrigins.has(req.headers.origin ?? '')) return reply(res, 403, { error: 'Request origin rejected' });
    const route = req.url?.split('?')[0];
    if (req.method === 'GET' && route === '/api/health') return reply(res, 200, await health());
    if (req.method === 'GET' && route === '/api/session') return reply(res, 200, { actor: auth.session(token(req))?.actor ?? null, expiresAt: auth.session(token(req))?.expiresAt ?? null, network });
    if (req.method === 'POST' && route === '/api/auth/challenge') {
      const input = z.object({ actor: walletAddress }).strict().parse(await body(req));
      return reply(res, 200, auth.challenge(input.actor));
    }
    if (req.method === 'POST' && route === '/api/auth/verify') {
      const input = z.object({ id: z.string().uuid(), signature: z.string().min(1).max(8192) }).strict().parse(await body(req));
      const result = await auth.verify(input.id, input.signature);
      res.setHeader('set-cookie', `janus_session=${result.token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=1800${runtimeUrl.protocol==='https:'?'; Secure':''}`);
      return reply(res, 200, { actor: result.actor, expiresAt: result.expiresAt });
    }
    if (req.method === 'POST' && route === '/api/auth/logout') {
      auth.logout(token(req));
      res.setHeader('set-cookie', 'janus_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0');
      return reply(res, 200, { status: 'signed_out' });
    }
    if (req.method === 'POST' && route === '/api/wallet-check/prepare') {
      const actor = session(req);
      z.object({}).strict().parse(await body(req));
      const transaction = new Transaction();
      transaction.setSender(actor);
      transaction.setGasBudget(10_000_000);
      const [coin] = transaction.splitCoins(transaction.gas, [transaction.pure.u64(1)]);
      transaction.transferObjects([coin!], actor);
      const bytes = await transaction.build({ client });
      const simulated = await client.simulateTransaction({ transaction: bytes, checksEnabled: true, include: { effects: true } });
      if (!simulated.Transaction || simulated.gasPaymentMocked) return reply(res, 409, { error: 'A valid funded testnet gas payment is required for this check' });
      const id = randomUUID(), digest = await Transaction.from(bytes).getDigest(), expiresAt = now + 120_000;
      db.prepare('DELETE FROM wallet_preparations WHERE expires <= ? OR actor = ?').run(now, actor);
      db.prepare('INSERT INTO wallet_preparations (id, actor, session_hash, bytes, digest, expires) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, actor, auth.hash(token(req)), toBase64(bytes), digest, expiresAt);
      return reply(res, 200, { id, bytes: toBase64(bytes), digest, actor, network, expiresAt,
        action: 'Sign-only check: transfer 1 MIST to your own address', gasBudgetMist: '10000000', broadcasts: false });
    }
    if (req.method === 'POST' && route === '/api/wallet-check/verify') {
      const actor = session(req);
      const input = z.object({ id: z.string().uuid(), bytes: z.string().max(16384), signature: z.string().max(8192) }).strict().parse(await body(req));
      const prep = db.prepare('SELECT * FROM wallet_preparations WHERE id = ? AND actor = ? AND session_hash = ? AND expires > ? AND verified = 0')
        .get(input.id, actor, auth.hash(token(req)), now) as { bytes: string; digest: string; actor: string } | undefined;
      if (!prep) return reply(res, 409, { error: 'Preparation expired, was used, or belongs to another wallet session' });
      await verifyApprovedBytes(prep, input, { client });
      if (auth.actor(token(req)) !== actor) throw new AuthError('Wallet session ended');
      const result = db.prepare('UPDATE wallet_preparations SET verified = 1 WHERE id = ? AND verified = 0 AND expires > ?').run(input.id, Date.now());
      if (result.changes !== 1) return reply(res, 409, { error: 'Preparation expired or was already verified' });
      return reply(res, 200, { status: 'signature_verified', digest: prep.digest, network, broadcast: false });
    }
    if (await appRoutes(req,res)) return;
    if(req.method==='GET' && !route?.startsWith('/api/')){if(await serveWeb(req,res))return;}
    return reply(res, 404, { error: 'Endpoint not available' });
  } catch (error) {
    if (error instanceof CopilotError) return reply(res,error.status,{error:error.message,code:error.code});
    if (error instanceof WorkflowError) return reply(res,error.status,{error:error.message,...(error.operationId?{operationId:error.operationId}:{})});
    if (error instanceof BusyError) return reply(res,409,{error:error.message});
    if (error instanceof AuthError) return reply(res, 401, { error: error.message });
    if (error instanceof z.ZodError) return reply(res, 400, { error: 'Invalid request fields' });
    if (isProviderRateLimit(error)) return reply(res,429,{error:'Provider rate limit reached. Wait before revalidating or preparing again. No automatic transaction retry was performed.'});
    // SDK errors may contain RPC URLs, account context or upstream payloads.
    // Keep their raw messages out of HTTP responses and stdout.
    return reply(res, 503, { error: 'Provider or wallet check failed. Check testnet funds and provider connectivity. If signing/submission was attempted, inspect its known digest before retrying.' });
  }
});
server.requestTimeout = 30_000; server.headersTimeout = 10_000;
server.listen(port, process.env.JANUS_BIND ?? '127.0.0.1', () => console.log('Janus integration API: http://localhost:4311 (local app; wallet-approved testnet transactions only)'));
function shutdown() { clearInterval(workerTimer); if(copilotTimer)clearInterval(copilotTimer); server.close(); close(); memory.destroy(); db.close(); }
process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
