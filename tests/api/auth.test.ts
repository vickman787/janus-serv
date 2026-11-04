import { DatabaseSync } from 'node:sqlite';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { describe, it, expect } from 'vitest';
import { AuthStore } from '../../apps/api/src/auth.js';

function setup() { return new AuthStore(new DatabaseSync(':memory:'), 'http://localhost:4310', 'testnet'); }
describe('wallet authentication (local cryptographic fixtures)', () => {
  it('binds the challenge to domain, network, actor and expiry', () => {
    const store = setup(), actor = Ed25519Keypair.generate().toSuiAddress();
    const challenge = store.challenge(actor);
    expect(challenge.message).toContain('Origin: http://localhost:4310');
    expect(challenge.message).toContain('Network: sui:testnet');
    expect(challenge.message).toContain(actor);
    expect(challenge.message).toContain(challenge.id);
    store.db.close();
  });
  it('issues an opaque server session only after proving wallet ownership', async () => {
    const store = setup(), wallet = Ed25519Keypair.generate();
    const challenge = store.challenge(wallet.toSuiAddress());
    const signed = await wallet.signPersonalMessage(new TextEncoder().encode(challenge.message));
    const session = await store.verify(challenge.id, signed.signature);
    expect(store.actor(session.token)).toBe(wallet.toSuiAddress());
    expect(store.session(session.token)).toEqual({actor:wallet.toSuiAddress(),expiresAt:session.expiresAt});
    expect(store.session(session.token, session.expiresAt)).toBeUndefined();
    expect(store.actor(session.token, session.expiresAt)).toBeUndefined();
    expect(store.actor('invalid')).toBeUndefined();
    const row = store.db.prepare('SELECT hash FROM sessions').get() as { hash: string };
    expect(row.hash).not.toBe(session.token);
    store.logout(session.token); expect(store.actor(session.token)).toBeUndefined();
    store.db.close();
  });
  it('consumes a nonce once across concurrent verification attempts', async () => {
    const store = setup(), wallet = Ed25519Keypair.generate();
    const challenge = store.challenge(wallet.toSuiAddress());
    const signed = await wallet.signPersonalMessage(new TextEncoder().encode(challenge.message));
    const results = await Promise.allSettled([store.verify(challenge.id, signed.signature), store.verify(challenge.id, signed.signature)]);
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(row => row.status === 'rejected')).toHaveLength(1);
    store.db.close();
  });
  it('refuses another signer and burns the failed challenge', async () => {
    const store = setup(), wallet = Ed25519Keypair.generate(), attacker = Ed25519Keypair.generate();
    const challenge = store.challenge(wallet.toSuiAddress());
    const signed = await attacker.signPersonalMessage(new TextEncoder().encode(challenge.message));
    await expect(store.verify(challenge.id, signed.signature)).rejects.toThrow('verification failed');
    await expect(store.verify(challenge.id, signed.signature)).rejects.toThrow('already used');
    store.db.close();
  });
  it('refuses expired and altered-domain messages', async () => {
    const store = setup(), wallet = Ed25519Keypair.generate();
    const expired = store.challenge(wallet.toSuiAddress(), Date.now() - 6 * 60_000);
    const signedExpired = await wallet.signPersonalMessage(new TextEncoder().encode(expired.message));
    await expect(store.verify(expired.id, signedExpired.signature)).rejects.toThrow('expired');
    const challenge = store.challenge(wallet.toSuiAddress());
    const signedOther = await wallet.signPersonalMessage(new TextEncoder().encode(challenge.message.replace('localhost:4310', 'attacker.example')));
    await expect(store.verify(challenge.id, signedOther.signature)).rejects.toThrow('verification failed');
    store.db.close();
  });
});
