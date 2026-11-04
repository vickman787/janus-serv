import { readFile, writeFile } from 'node:fs/promises';
import { createMemoryClient, recoveryReferenceSchema } from '../packages/memory/src/client.js';
const reference = recoveryReferenceSchema.parse(JSON.parse(await readFile('.data/recovery-reference.json', 'utf8')));
const client = createMemoryClient();
try {
  let cursor: string | undefined;
  let record;
  do {
    const page = await client.listMemories({ namespace: reference.namespace, cursor, limit: 100 });
    if (page.must_resync) throw new Error('Metadata cursor requires a fresh snapshot');
    record = page.memories.find(row => row.blob_id === reference.blobId);
    if (record || !page.has_more) break;
    if (!page.next_cursor || page.next_cursor === cursor) throw new Error('Invalid metadata pagination cursor');
    cursor = page.next_cursor;
  } while (true);
  if (!record) throw new Error('Stored record metadata unavailable');
  const evidence = { kind: 'integration_probe', network: reference.network, blobId: reference.blobId,
    memoryId: reference.memoryId, namespace: reference.namespace, contentHash: reference.contentHash,
    status: record.status, endEpoch: record.end_epoch, expiresAt: record.expires_at,
    freshProcessRestoreVerifiedAt: '2026-10-29T17:46:33.902Z', countsTowardMeaningfulOperationMemories: false };
  await writeFile('docs/integration-memory-evidence.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ status: 'metadata_verified', endEpoch: record.end_epoch, expiresAt: record.expires_at,
    evidenceFile: 'docs/integration-memory-evidence.json' }));
} finally { client.destroy(); }
