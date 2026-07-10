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
    const patch = appendSystemNotice(freshState(), '[lf2] Check baud rate.');

    expect(patch.log).toContain('[lf2] Check baud rate.');
    expect(patch.transcript).toHaveLength(1);
    const entry = patch.transcript[patch.transcript.length - 1];
    expect(entry?.direction).toBe('system');
    expect(entry?.source).toBe('system');
    expect(entry?.raw).toBe('[lf2] Check baud rate.');
  });

  it('derives the next id from the last entry id, not the array length (survives the 500-cap slice)', () => {
    const state = {
      ...freshState(),
      transcript: [systemTranscriptEntry(742, 0, 'earlier', 'message')],
    };

    const patch = appendSystemNotice(state, 'next');

    expect(patch.transcript[patch.transcript.length - 1]?.id).toBe(743);
  });
});
