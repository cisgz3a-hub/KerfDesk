import { describe, expect, it } from 'vitest';
import type { StreamerStatus } from '../../core/controllers/grbl/streamer';
import { bitFileRunEndPatch, bitFileSequenceNotice } from './bit-file-sequence';
import type { LaserState } from './laser-store';

// Rolling audit v5 J9-P3-1 (ADR-392 Amendment 6): only a file that ran to its
// end moves the set on to the next bit; a stopped or failed one is run again.

function ended(status: StreamerStatus, order: number, count = 2) {
  return bitFileRunEndPatch({
    workZReferenceEpoch: 3,
    streamer: { status } as LaserState['streamer'],
    bitFileRun: { order, count, bitName: '3.175 mm end mill' },
  });
}

describe('bitFileRunEndPatch', () => {
  it('moves a finished file on to the next bit and ends the set after the last', () => {
    expect(ended('done', 1).bitFileSequence).toMatchObject({ order: 1, finished: true });
    expect(ended('done', 2).bitFileSequence).toBeNull();
  });

  it.each(['cancelled', 'errored'] as const)(
    'holds a %s file for a re-run, the last bit too, and voids its Work Z',
    (status) => {
      for (const order of [1, 2]) {
        const patch = ended(status, order);
        expect(patch.bitFileSequence).toMatchObject({ order, finished: false });
        expect(patch.workZZeroEvidence).toBeNull();
        expect(patch.workZReferenceEpoch).toBe(4);
        const notice = bitFileSequenceNotice(patch);
        expect(notice).toContain(`stopped before its file finished`);
        expect(notice).toContain(`run bit ${order}'s file again`);
        expect(notice).not.toContain('Change to bit');
      }
    },
  );

  it('does nothing when no per-bit file was running', () => {
    expect(
      bitFileRunEndPatch({ workZReferenceEpoch: 3, streamer: null, bitFileRun: null }),
    ).toEqual({});
  });
});
