import { createHash, createPublicKey, sign, verify, type KeyLike } from 'node:crypto';
import { z } from 'zod';
import { checkpointSchema, type Checkpoint } from '../../domain/src/models.js';

const envelopeSchema = z.object({ version: z.literal(1), writer: z.string(), payload: z.string(), signature: z.string() }).strict();
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export function signCheckpoint(checkpoint: Checkpoint, privateKey: KeyLike): string {
  const payload = JSON.stringify(checkpointSchema.parse(checkpoint));
  const writer = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64');
  return JSON.stringify({ version: 1, writer, payload, signature: sign(null, Buffer.from(payload), privateKey).toString('base64') });
}

export function verifyCheckpoint(text: string, trustedWriter: string, expectedHash: string): Checkpoint {
  if (sha256(text) !== expectedHash) throw new Error('Recovery record hash differs from trusted reference');
  const envelope = envelopeSchema.parse(JSON.parse(text));
  if (envelope.writer !== trustedWriter) throw new Error('Unauthorized checkpoint writer');
  const publicKey = createPublicKey({ key: Buffer.from(trustedWriter, 'base64'), type: 'spki', format: 'der' });
  if (publicKey.asymmetricKeyType !== 'ed25519' || !verify(null, Buffer.from(envelope.payload), publicKey, Buffer.from(envelope.signature, 'base64'))) {
    throw new Error('Checkpoint signature invalid');
  }
  return checkpointSchema.parse(JSON.parse(envelope.payload));
}
