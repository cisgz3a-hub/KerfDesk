import { describe, expect, it } from 'vitest';
import { useLaserStore } from './laser-store';
import { systemTranscriptEntry } from './laser-transcript';
import { appendSystemNotice } from './laser-system-notice';

// A full, valid LaserState with empty log/transcript to write into.
function freshState() {
  return { ...useLaserStore.getState(), log: [], transcript: [] };
}

describe('appendSystemNotice', () => {
  it('writes the notice to BOTH the log and the Console transcript', () => {
    const patch = appendSystemNotice(
      freshState(),
      { nextTranscriptId: 1 },
      '[lf2] Check baud rate.',
    );

    expect(patch.log).toContain('[lf2] Check baud rate.');
    expect(patch.transcript).toHaveLength(1);
    const entry = patch.transcript[patch.transcript.length - 1];
    expect(entry?.direction).toBe('system');
    expect(entry?.source).toBe('system');
    expect(entry?.raw).toBe('[lf2] Check baud rate.');
  });

  it('takes its id from the shared refs counter and advances it (no collision with controller lines)', () => {
    const refs = { nextTranscriptId: 743 };
    const state = {
      ...freshState(),
      transcript: [systemTranscriptEntry(742, 0, 'earlier', 'message')],
    };

    const first = appendSystemNotice(state, refs, 'next');
    expect(first.transcript[first.transcript.length - 1]?.id).toBe(743);
    // The counter advanced, so the next allocation — a system notice OR a
    // controller line drawing from the same refs — cannot reuse 743.
    expect(refs.nextTranscriptId).toBe(744);
    const second = appendSystemNotice({ ...state, transcript: first.transcript }, refs, 'again');
    expect(second.transcript[second.transcript.length - 1]?.id).toBe(744);
    expect(refs.nextTranscriptId).toBe(745);
  });
});
