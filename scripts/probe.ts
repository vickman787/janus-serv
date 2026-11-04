import { createTatumClient, inspectTransaction } from '../packages/chain/src/tatum.js';
import { createMemoryClient } from '../packages/memory/src/client.js';

let blocked = false;
async function probe(name: string, run: () => Promise<unknown>) {
  try { console.log(JSON.stringify({ name, status: 'verified', at: new Date().toISOString(), result: await run() })); }
  catch (error) {
    blocked = true;
    // Do not print provider error bodies/URLs or environment values.
    console.log(JSON.stringify({ name, status: 'blocked', errorType: error instanceof Error ? error.name : 'UnknownError',
      instruction: 'Check required configuration, account permissions and provider connectivity; secrets are not logged.' }));
  }
}
await probe('Tatum native gRPC read-only', async () => {
  const { client, close } = createTatumClient();
  try {
    const { response } = await client.ledgerService.getServiceInfo({});
    const checkpoint = await client.ledgerService.getCheckpoint({ checkpointId: { oneofKind: undefined }, readMask: { paths: ['sequence_number', 'digest'] } });
    const object = process.env.JANUS_CONTROL_OBJECT_ID
      ? await client.getObject({ objectId: process.env.JANUS_CONTROL_OBJECT_ID }) : undefined;
    const transaction = process.env.JANUS_TRANSACTION_DIGEST
      ? await inspectTransaction(client, process.env.JANUS_TRANSACTION_DIGEST) : undefined;
    return { chainId: response.chainId, checkpoint: checkpoint.response.checkpoint?.sequenceNumber?.toString(),
      object: object ? 'retrieved' : 'not_configured', transaction: transaction ?? 'not_configured' };
  } finally { close(); }
});
await probe('Walrus authenticated metadata (no writes)', async () => {
  const client = createMemoryClient();
  try {
    const health = await client.health();
    const page = await client.listMemories({ limit: 1 });
    return { relayerStatus: health.status, authenticated: true, firstPageRecords: page.memories.length, hasMore: page.has_more };
  } finally { client.destroy(); }
});
if (blocked) process.exitCode = 1;
