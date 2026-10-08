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
import { publishControllerIncident } from './laser-incident-publish';

export function appendSystemNotice(
  state: LaserState,
  refs: { nextTranscriptId?: number },
  line: string,
  incident = false,
): Pick<LaserState, 'log' | 'transcript' | 'incidentHistory'> {
  if (incident) return publishControllerIncident(refs, state, line, 'message');
  // Draw the id from the ONE shared owner — refs.nextTranscriptId, the same
  // counter controller in/out lines use — and advance it. Deriving lastId+1
  // independently would hand this notice the id the next controller line is
  // about to take, colliding on the ConsolePanel React key (Codex audit).
  const id = refs.nextTranscriptId ?? 1;
  refs.nextTranscriptId = id + 1;
  return {
    log: pushLog(state, line),
    transcript: appendTranscript(
      state.transcript,
      systemTranscriptEntry(id, Date.now(), line, 'message'),
    ),
  };
}
