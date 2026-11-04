import { z } from 'zod';
import { address } from './models.js';

export const preferenceSchema = z.object({
  id: z.string().uuid(), owner: address, workflow: z.literal('administrative_handover'),
  kind: z.literal('successor_change_review'), revision: z.number().int().nonnegative().safe(),
  approvedAt: z.iso.datetime(), revoked: z.boolean(), sourceRecordId: z.string().min(1),
}).strict();
export type Preference = z.infer<typeof preferenceSchema>;

// The latest pointer must come from the authenticated durable preference index.
// Never choose a revision by sorting a truncated semantic search response.
export function applyReviewPreference(value: unknown, actor: string, latest: { id: string; revision: number; sourceRecordId: string }, writerVerified: boolean) {
  const result = preferenceSchema.safeParse(value);
  if (!result.success || !writerVerified) return null;
  const p = result.data;
  if (p.owner !== actor || p.id !== latest.id || p.revision !== latest.revision || p.sourceRecordId !== latest.sourceRecordId || p.revoked) return null;
  return {
    sourceRecordId: p.sourceRecordId,
    explanation: 'Applied your saved review preference: show successor changes side by side and require a review checklist.',
    showChangeSummary: true,
    checklist: ['Compare the remembered and current successor.', 'Review the current proposal revision and expiry.', 'Revalidate before requesting a new wallet approval.'],
  } as const;
}
