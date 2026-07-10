// appendSystemNotice — an app diagnostic ([lf2] notice) that the operator must
// actually see. The Console panel renders the transcript, not the legacy `log`
// array, so a notice written only to `log` is invisible. This writes to BOTH:
// the transcript (the mounted surface) and `log` (kept for history/tests).
//
// UI layer, not core: it reads Date.now() for the entry timestamp.

import { pushLog } from './laser-store-helpers';
import { appendTranscript, systemTranscriptEntry } from './laser-transcript';
// Type-only, erased at compile time — no runtime cycle with laser-store.
import type { LaserState } from './laser-store';

export function appendSystemNotice(
  state: LaserState,
  line: string,
): Pick<LaserState, 'log' | 'transcript'> {
  // Derive the next id from the last entry's id (NOT the array length — the
  // transcript is capped at TRANSCRIPT_MAX, so length plateaus while ids grow).
  const lastId = state.transcript[state.transcript.length - 1]?.id ?? 0;
  return {
    log: pushLog(state, line),
    transcript: appendTranscript(
      state.transcript,
      systemTranscriptEntry(lastId + 1, Date.now(), line, 'message'),
    ),
  };
}
