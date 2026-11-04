import { createTatumClient } from '../packages/chain/src/tatum.js';
const { client, close } = createTatumClient();
try {
  const info = await client.ledgerService.getServiceInfo({});
  const clock = await client.getObject({ objectId: '0x6' });
  const checkpoint = await client.ledgerService.getCheckpoint({ checkpointId: { oneofKind: undefined },
    readMask: { paths: ['sequence_number', 'digest', 'transactions.digest'] } });
  const digest = checkpoint.response.checkpoint?.transactions[0]?.digest;
  if (!digest) throw new Error('No transaction returned from checkpoint');
  const result = await client.getTransaction({ digest, include: { effects: true } });
  const transaction = result.Transaction ?? result.FailedTransaction;
  if (!transaction?.effects) throw new Error('Transaction effects missing');
  console.log(JSON.stringify({ provider: 'Tatum native gRPC', configuredNetwork: process.env.SUI_NETWORK,
    chainId: info.response.chainId, checkpoint: checkpoint.response.checkpoint?.sequenceNumber?.toString(),
    clockObject: clock.object.objectId, digest: transaction.digest, effects: transaction.status,
    verifiedAt: new Date().toISOString(), writes: false }));
} finally { close(); }
