import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';

export class AuthError extends Error {}
export class AuthStore {
  constructor(readonly db: DatabaseSync, readonly origin: string, readonly network: string, readonly verificationOptions?: Parameters<typeof verifyPersonalMessageSignature>[2]) {
    db.exec(`PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, actor TEXT NOT NULL, message TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, actor TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS wallet_preparations (id TEXT PRIMARY KEY, actor TEXT NOT NULL, session_hash TEXT NOT NULL,
        bytes TEXT NOT NULL, digest TEXT NOT NULL, expires INTEGER NOT NULL, verified INTEGER NOT NULL DEFAULT 0);`);
  }
  hash(token: string) { return createHash('sha256').update(token).digest('hex'); }
  challenge(actor: string, now = Date.now()) {
    const id = randomUUID(), expiresAt = now + 5 * 60_000;
    const message = ['Janus wallet authentication', `Origin: ${this.origin}`, `Network: sui:${this.network}`,
      `Address: ${actor}`, `Nonce: ${id}`, `Issued: ${new Date(now).toISOString()}`, `Expires: ${new Date(expiresAt).toISOString()}`,
      'Purpose: prove wallet ownership for Janus. This message does not authorize transactions.'].join('\n');
    this.db.prepare('DELETE FROM challenges WHERE expires <= ?').run(now);
    this.db.prepare('INSERT INTO challenges VALUES (?, ?, ?, ?)').run(id, actor, message, expiresAt);
    return { id, message, expiresAt };
  }
  async verify(id: string, signature: string, now = Date.now()) {
    // Consume once before the async verification boundary. SQLite deletion is
    // atomic across processes: a second verifier cannot reuse this nonce.
    const row = this.db.prepare('DELETE FROM challenges WHERE id = ? RETURNING *').get(id) as
      { actor: string; message: string; expires: number } | undefined;
    if (!row || row.expires <= now) throw new AuthError('Challenge expired or already used');
    try {
      const key = await verifyPersonalMessageSignature(new TextEncoder().encode(row.message), signature, { ...this.verificationOptions, address: row.actor });
      if (key.toSuiAddress() !== row.actor) throw new AuthError('Wrong wallet');
    } catch { throw new AuthError('Wallet signature verification failed'); }
    if (row.expires <= Date.now()) throw new AuthError('Challenge expired during verification');
    const token = randomBytes(32).toString('base64url'), expiresAt = now + 30 * 60_000;
    this.db.prepare('DELETE FROM sessions WHERE expires <= ?').run(now);
    this.db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(this.hash(token), row.actor, expiresAt);
    return { token, actor: row.actor, expiresAt };
  }
  session(token: string, now = Date.now()) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    const row = this.db.prepare('SELECT actor, expires FROM sessions WHERE hash = ? AND expires > ?').get(this.hash(token), now) as { actor: string; expires: number } | undefined;
    return row ? { actor: row.actor, expiresAt: row.expires } : undefined;
  }
  actor(token: string, now = Date.now()) { return this.session(token, now)?.actor; }
  logout(token: string) {
    this.db.prepare('DELETE FROM wallet_preparations WHERE session_hash = ?').run(this.hash(token));
    this.db.prepare('DELETE FROM sessions WHERE hash = ?').run(this.hash(token));
  }
}
