import type { LaserState } from './laser-store';
import type { TranscriptBufferRefs } from './laser-transcript-buffer';

/** Clearing evidence is separate from acknowledging safety or settling machine state. */
export function clearIncidentHistoryPatch(
  refs: TranscriptBufferRefs,
  state: LaserState,
): Partial<LaserState> {
  const ids = new Set((state.incidentHistory ?? []).map((entry) => entry.id));
  // Restore ring order before removing IDs; ordinary held-back ACKs remain intact.
  const buffered = refs.bufferedTranscript ?? [];
  const start = refs.bufferedTranscriptStart ?? 0;
  refs.bufferedTranscript = [...buffered.slice(start), ...buffered.slice(0, start)].filter(
    (entry) => !ids.has(entry.id),
  );
  refs.bufferedTranscriptStart = 0;
  return {
    incidentHistory: [],
    transcript: state.transcript.filter((entry) => !ids.has(entry.id)),
  };
}
