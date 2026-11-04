import { readFile } from 'node:fs/promises';
import { createMemoryClient, recoveryReferenceSchema, retrieveCandidate } from '../packages/memory/src/client.js';
import { sha256 } from '../packages/memory/src/envelope.js';

const reference = recoveryReferenceSchema.parse(JSON.parse(await readFile(process.argv[2] ?? '.data/recovery-reference.json', 'utf8')));
if (reference.accountId !== process.env.WALRUS_MEMORY_ACCOUNT_ID || reference.network !== (process.env.WALRUS_MEMORY_NETWORK ?? 'mainnet')) {
  throw new Error('Recovery reference belongs to a different configured memory account/network');
}
const client = createMemoryClient();
try {
  const text = await retrieveCandidate(client, reference);
  if (sha256(text) !== reference.contentHash) throw new Error('Record hash mismatch');
  console.log(JSON.stringify({ status: 'retrieved_and_hash_verified', network: reference.network, blobId: reference.blobId, at: new Date().toISOString() }));
  // This proves probe payload retrieval only. Production checkpoints also need
  // signed writer verification and trusted latest-revision validation.
} finally { client.destroy(); }
