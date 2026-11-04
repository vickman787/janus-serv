import { generateKeyPairSync } from 'node:crypto';
import { it, expect } from 'vitest';
import { sha256, signCheckpoint, verifyCheckpoint } from '../../packages/memory/src/envelope.js';
import { applyReviewPreference } from '../../packages/domain/src/preferences.js';
import { fixture } from './fixtures.js';
import type { Checkpoint } from '../../packages/domain/src/models.js';

it('authenticates record writer and detects tampering beyond hash linking', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const cp = (fixture().memory as { value: Checkpoint }).value;
  const text = signCheckpoint(cp, privateKey);
  const trusted = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  expect(verifyCheckpoint(text, trusted, sha256(text))).toEqual(cp);
  const changed = text.replace('20000', '90000');
  expect(() => verifyCheckpoint(changed, trusted, sha256(changed))).toThrow('signature');
  expect(() => verifyCheckpoint(text, 'other-writer', sha256(text))).toThrow('Unauthorized');
  expect(() => verifyCheckpoint(text, trusted, sha256('other'))).toThrow('hash');
});

const preference = { id: '550e8400-e29b-41d4-a716-446655440002', owner: `0x${'1'.repeat(64)}`, workflow: 'administrative_handover',
  kind: 'successor_change_review', revision: 2, approvedAt: '2026-10-28T20:00:00Z', revoked: false, sourceRecordId: 'record-2' };
const pointer = { id: preference.id, revision: 2, sourceRecordId: 'record-2' };
it('applies only bounded presentation behavior with visible provenance', () => {
  expect(applyReviewPreference(preference, preference.owner, pointer, true)?.sourceRecordId).toBe('record-2');
});
it('rejects revoked, other-owner, stale and unauthenticated preferences', () => {
  expect(applyReviewPreference({ ...preference, revoked: true }, preference.owner, pointer, true)).toBeNull();
  expect(applyReviewPreference(preference, `0x${'2'.repeat(64)}`, pointer, true)).toBeNull();
  expect(applyReviewPreference({ ...preference, revision: 1 }, preference.owner, pointer, true)).toBeNull();
  expect(applyReviewPreference(preference, preference.owner, pointer, false)).toBeNull();
  expect(applyReviewPreference({ ...preference, autoSign: true }, preference.owner, pointer, true)).toBeNull();
});
