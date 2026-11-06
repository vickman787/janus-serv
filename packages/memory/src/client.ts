import { MemWal } from '@mysten-incubation/memwal';
import { z } from 'zod';

export function createMemoryClient(env: NodeJS.ProcessEnv = process.env) {
  const network = z.enum(['mainnet', 'testnet']).parse(env.WALRUS_MEMORY_NETWORK ?? 'mainnet');
  const expectedUrl = network === 'mainnet' ? 'https://relayer.memory.walrus.xyz' : 'https://relayer-staging.memory.walrus.xyz';
  const serverUrl = env.WALRUS_MEMORY_SERVER_URL ?? expectedUrl;
  if (serverUrl !== expectedUrl) throw new Error('Walrus relayer does not match configured memory network');
  return MemWal.create({
    key: z.string().min(1, 'Missing memory delegate key').parse(env.WALRUS_MEMORY_DELEGATE_SECRET),
    accountId: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Missing/invalid memory account').parse(env.WALRUS_MEMORY_ACCOUNT_ID),
    serverUrl, namespace: env.WALRUS_MEMORY_NAMESPACE ?? 'janus-spike',
    requestTimeoutMs: 15_000, recallTimeoutMs: 30_000, preflightTimeoutMs: 20_000,
  });
}

export const recoveryReferenceSchema = z.object({
  version: z.literal(1), network: z.enum(['mainnet', 'testnet']),
  accountId: z.string(), namespace: z.string().regex(/^janus-openserv-record-[0-9a-f-]{36}$/),
  memoryId: z.string().min(1), blobId: z.string().min(1), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type RecoveryReference = z.infer<typeof recoveryReferenceSchema>;

// Candidate retrieval only: match EXACT blob id, then independently authenticate
// the hash and signed envelope. An empty search is NOT evidence of record absence.
// A single-record immutable namespace reduces candidate competition, but live
// retrieval/retention guarantees remain a Phase A gate, not a proven KV API.
export async function retrieveCandidate(client: MemWal, reference: RecoveryReference) {
  const result = await client.recall({ query: 'Janus recovery checkpoint', namespace: reference.namespace, limit: 100 });
  const matches = result.results.filter(row => row.blob_id === reference.blobId);
  if (matches.length !== 1) throw new Error('Referenced blob not retrievable; memory unavailable, not confirmed absent');
  return matches[0]!.text;
}
