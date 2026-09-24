// Why the last completed Frame expired (controller audit gap-start-2). The
// invalidation subscription consumes a permit silently the moment the job or
// the controller drifts. Start stays disabled until a clean Frame, so the
// status line beside it says why the earlier Frame no longer counts; the note
// lasts until the next Frame begins.

import { create } from 'zustand';

type FrameExpiryNote = { readonly reason: string | null };

export const useFrameExpiryNote = create<FrameExpiryNote>(() => ({ reason: null }));

export function noteFrameExpired(reason: string): void {
  useFrameExpiryNote.setState({ reason });
}

/** A new Frame supersedes the expired one. */
export function clearFrameExpiryNote(): void {
  if (useFrameExpiryNote.getState().reason !== null) useFrameExpiryNote.setState({ reason: null });
}

export function frameExpiryReason(): string | null {
  return useFrameExpiryNote.getState().reason;
}

export function frameExpiredStartMessage(reason: string): string {
  return `${reason} Frame the job again to unlock Start.`;
}
