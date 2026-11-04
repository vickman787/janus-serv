import { Transaction } from '@mysten/sui/transactions';
import { verifyTransactionSignature } from '@mysten/sui/verify';
import { fromBase64 } from '@mysten/sui/utils';

// Authentication, durable preparation lookup, leases and live revalidation are
// required by the eventual submit endpoint before this helper may be called.
export async function verifyApprovedBytes(prepared: { bytes: string; digest: string; actor: string }, signed: { bytes: string; signature: string }, options?: Parameters<typeof verifyTransactionSignature>[2]) {
  if (signed.bytes !== prepared.bytes) throw new Error('Wallet changed the prepared transaction bytes');
  const bytes = fromBase64(signed.bytes);
  const digest = await Transaction.from(bytes).getDigest();
  if (digest !== prepared.digest) throw new Error('Prepared transaction digest mismatch');
  const publicKey = await verifyTransactionSignature(bytes, signed.signature, options);
  if (publicKey.toSuiAddress() !== prepared.actor) throw new Error('Signature does not belong to the prepared actor');
  return { bytes, signature: signed.signature, digest };
}
