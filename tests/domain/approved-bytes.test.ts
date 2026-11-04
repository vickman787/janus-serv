import { it, expect } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/sui/utils';
import { verifyApprovedBytes } from '../../packages/chain/src/approved-bytes.js';

it('verifies exact sign-only bytes, transaction identity and signer offline', async () => {
  // Generated ephemeral fixture keys and nonexistent gas/object refs. No RPC,
  // wallet extension, funded account or network submission is involved.
  const signer = Ed25519Keypair.generate();
  const wrongSigner = Ed25519Keypair.generate();
  const actor = signer.toSuiAddress();
  const transaction = new Transaction();
  transaction.setSender(actor);
  transaction.setGasPrice(1000);
  transaction.setGasBudget(1000000);
  transaction.setGasPayment([{ objectId: `0x${'c'.repeat(64)}`, version: '1', digest: '11111111111111111111111111111111' }]);
  transaction.transferObjects([transaction.objectRef({ objectId: `0x${'d'.repeat(64)}`, version: '1', digest: '11111111111111111111111111111111' })], wrongSigner.toSuiAddress());
  const bytes = await transaction.build();
  const prepared = { actor, bytes: toBase64(bytes), digest: await transaction.getDigest() };
  const signed = await signer.signTransaction(bytes);
  expect((await verifyApprovedBytes(prepared, signed)).digest).toBe(prepared.digest);
  await expect(verifyApprovedBytes({ ...prepared, digest: 'incorrect' }, signed)).rejects.toThrow('digest');
  await expect(verifyApprovedBytes(prepared, { ...signed, bytes: 'changed' })).rejects.toThrow('changed');
  await expect(verifyApprovedBytes(prepared, await wrongSigner.signTransaction(bytes))).rejects.toThrow('prepared actor');
});
