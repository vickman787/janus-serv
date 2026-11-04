import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createMemoryClient, retrieveCandidate, type RecoveryReference } from '../packages/memory/src/client.js';
import { sha256 } from '../packages/memory/src/envelope.js';

// This separate command deliberately writes a paid/persistent memory. Never run
// as part of health checks or app startup. Owner approval is required.
if (!process.argv.includes('--owner-approved-write')) throw new Error('Explicit owner-approved write flag required');
const client = createMemoryClient();
try {
  const namespace = `janus-record-${randomUUID()}`;
  const text = JSON.stringify({ type: 'integration_probe', schemaVersion: 1, label: 'Janus recovery checkpoint',
    nonce: randomUUID(), createdAt: new Date().toISOString(), purpose: 'Verify write acknowledgment and fresh-process retrieval; not a handover checkpoint.' });
  const accepted = await client.remember(text, namespace);
  await mkdir('.data', { recursive: true });
  // Save job pointer before polling. No credential, private context or signed transaction.
  await writeFile('.data/memory-job.json', JSON.stringify({ jobId: accepted.job_id, namespace }));
  const record = await client.waitForRememberJob(accepted.job_id, { timeoutMs: 45_000 });
  const reference: RecoveryReference = { version: 1, network: process.env.WALRUS_MEMORY_NETWORK === 'testnet' ? 'testnet' : 'mainnet',
    accountId: process.env.WALRUS_MEMORY_ACCOUNT_ID!, namespace, memoryId: record.id, blobId: record.blob_id, contentHash: sha256(text) };
  await writeFile('.data/recovery-reference.json', JSON.stringify(reference, null, 2));
  const restored = await retrieveCandidate(client, reference);
  if (sha256(restored) !== reference.contentHash) throw new Error('Retrieved content does not match original');
  console.log('Stored and retrieved one probe memory. Run npm run probe:memory-restore in a fresh process. Reference: .data/recovery-reference.json');
} finally { client.destroy(); }
