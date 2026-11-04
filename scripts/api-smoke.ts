import assert from 'node:assert/strict';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
const origin = 'http://localhost:4310', base = 'http://127.0.0.1:4311';
const signer = Ed25519Keypair.generate();
async function post(path: string, value: unknown, cookie = '', requestOrigin = origin) {
  return fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: requestOrigin, cookie }, body: JSON.stringify(value) });
}
assert.equal((await post('/api/auth/challenge', { actor: signer.toSuiAddress() }, '', 'https://untrusted.example')).status, 403);
assert.equal((await post('/api/auth/challenge', { actor: 'bad-address' })).status, 400);
assert.equal((await post('/api/wallet-check/prepare', {})).status, 401);
const challengeResponse = await post('/api/auth/challenge', { actor: signer.toSuiAddress() });
assert.equal(challengeResponse.status, 200);
const challenge = await challengeResponse.json() as { id: string; message: string };
const signed = await signer.signPersonalMessage(new TextEncoder().encode(challenge.message));
const verified = await post('/api/auth/verify', { id: challenge.id, signature: signed.signature });
assert.equal(verified.status, 200);
const cookie = verified.headers.get('set-cookie')!.split(';')[0]!;
assert.match(verified.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict/);
const session = await fetch(base + '/api/session', { headers: { cookie } }).then(r => r.json()) as { actor: string };
assert.equal(session.actor, signer.toSuiAddress());
assert.equal((await post('/api/auth/verify', { id: challenge.id, signature: signed.signature })).status, 401);
assert.equal((await post('/api/auth/logout', {}, cookie)).status, 200);
const ended = await fetch(base + '/api/session', { headers: { cookie } }).then(r => r.json()) as { actor: null };
assert.equal(ended.actor, null);
assert.equal((await post('/api/transactions/submit', {})).status, 401);
console.log(JSON.stringify({ status: 'passed', checks: ['origin rejection', 'invalid address rejection', 'authenticated prepare guard', 'real message signature', 'HttpOnly session', 'nonce replay refusal', 'logout invalidation', 'submission requires authenticated wallet'], transactionBroadcasts: 0 }));
