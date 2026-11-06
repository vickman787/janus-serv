import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { MemWal } from '@mysten-incubation/memwal';
import { sha256 } from './envelope.js';
export type MemoryRef = { namespace: string; blobId: string; memoryId: string; contentHash: string };
export type MemoryRecord = { kind: 'checkpoint' | 'preference' | 'journal' | 'outcome' | 'intent'; owner: string; operationId?: string; sequence: number; previousHash?: string; previousId?: string; createdAt: string; data: unknown };
export class MemoryAdapter {
  readonly key; readonly writer: string;
  constructor(readonly client: MemWal, keyPath = '.data/writer-private.pem', allowNewWriter=true, readonly namespacePrefix = 'janus-openserv-record') {
    if (!existsSync(keyPath)) {
      if(!allowNewWriter)throw new Error('Trusted writer key missing. Restore its backup before accessing existing records.');
      const key = generateKeyPairSync('ed25519');
      writeFileSync(keyPath, key.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
    }
    this.key = createPrivateKey(readFileSync(keyPath));
    this.writer = createPublicKey(this.key).export({ type: 'spki', format: 'der' }).toString('base64');
  }
  async write(record: MemoryRecord, accepted?: (jobId: string, namespace: string, contentHash: string) => void): Promise<MemoryRef> {
    const payload = JSON.stringify(record);
    const text = JSON.stringify({ version: 1, writer: this.writer, payload, signature: sign(null, Buffer.from(payload), this.key).toString('base64') });
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(this.namespacePrefix)) throw new Error('Invalid memory namespace prefix');
    const namespace = `${this.namespacePrefix}-${randomUUID()}`;
    const job = await this.client.remember(text, namespace, { idempotencyKey: sha256(text) });
    accepted?.(job.job_id, namespace, sha256(text));
    const result = await this.client.waitForRememberJob(job.job_id, { timeoutMs: 60_000 });
    const ref = { namespace, blobId: result.blob_id, memoryId: result.id, contentHash: sha256(text) };
    const restored = await this.read(ref);
    if (JSON.stringify(restored) !== payload) throw new Error('Memory round-trip validation failed');
    return ref;
  }
  async read(ref: MemoryRef): Promise<MemoryRecord> {
    const recall = () => this.client.recall({ query: 'Janus recovery checkpoint', namespace: ref.namespace, limit: 100 });
    let result: Awaited<ReturnType<typeof recall>>;
    try { result = await recall(); }
    catch (error) {
      // Retry only a read timeout, never a remember write or chain submission.
      if (!(error instanceof Error) || error.name !== 'MemWalRequestTimeout') throw error;
      result = await recall();
    }
    const hit = result.results.find(row => row.blob_id === ref.blobId);
    if (!hit) throw new Error('Memory temporarily unavailable or not indexed; not confirmed absent');
    if (sha256(hit.text) !== ref.contentHash) throw new Error('Memory hash mismatch');
    const envelope = JSON.parse(hit.text);
    if (envelope.version !== 1 || envelope.writer !== this.writer || typeof envelope.payload !== 'string' ||
      !verify(null, Buffer.from(envelope.payload), createPublicKey(this.key), Buffer.from(envelope.signature, 'base64'))) throw new Error('Memory writer/signature rejected');
    const record = JSON.parse(envelope.payload) as MemoryRecord;
    if (!['checkpoint','preference','journal','outcome','intent'].includes(record.kind) || !Number.isSafeInteger(record.sequence) || record.sequence < 0 || !/^0x[0-9a-f]{64}$/.test(record.owner)) throw new Error('Invalid memory record schema');
    return record;
  }
}
