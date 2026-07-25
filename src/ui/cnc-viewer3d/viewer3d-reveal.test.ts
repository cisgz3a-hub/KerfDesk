import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Move3d } from '../../core/toolpath3d';
import { revealedSegmentCount, segmentEndsMm } from './viewer3d-reveal';

function move(kind: Move3d['kind'], startMm: number, lengthMm: number, xs: number[]): Move3d {
  return {
    kind,
    startMm,
    lengthMm,
    points: xs.map((x) => ({ x, y: 0, z: 0 })),
  };
}

describe('segmentEndsMm', () => {
  it('places each segment end at its chord fraction of the move length', () => {
    // One 3-point move: chords of 1 and 3, so ends land at 25% and 100% of the
    // declared 8mm — not at the chord distances themselves.
    const ends = segmentEndsMm([move('cut', 10, 8, [0, 1, 4])], 'cut');
    expect(ends).toEqual([12, 18]);
  });

  it('measures against the declared length, not the drawn chord sum', () => {
    // An arc step: 100mm declared against a 10mm chord sum. Measuring geometry
    // would put the final segment at 10 and desync the reveal from the 2D
    // scrubber, which counts in declared arc length.
    const ends = segmentEndsMm([move('cut', 0, 100, [0, 5, 10])], 'cut');
    expect(ends[ends.length - 1]).toBe(100);
  });

  it('collects only the requested kind, skipping interleaved moves', () => {
    const moves = [
      move('cut', 0, 4, [0, 4]),
      move('rapid', 4, 6, [4, 10]),
      move('cut', 10, 2, [10, 12]),
    ];
    expect(segmentEndsMm(moves, 'cut')).toEqual([4, 12]);
    expect(segmentEndsMm(moves, 'rapid')).toEqual([10]);
  });

  it('emits one end per segment for a degenerate zero-length move', () => {
    // A plunge with identical endpoints has a zero chord sum. Dividing by it
    // would emit NaN and the binary search would stop being meaningful.
    const ends = segmentEndsMm([move('plunge', 5, 0, [2, 2])], 'plunge');
    expect(ends).toEqual([5]);
  });
});

describe('revealedSegmentCount', () => {
  it('counts only segments the tool has fully passed', () => {
    expect(revealedSegmentCount([2, 4, 6], 0)).toBe(0);
    expect(revealedSegmentCount([2, 4, 6], 4)).toBe(2);
    expect(revealedSegmentCount([2, 4, 6], 5)).toBe(2);
    expect(revealedSegmentCount([2, 4, 6], 99)).toBe(3);
  });

  it('reveals the whole batch at the end of the program', () => {
    const moves = [move('cut', 0, 10, [0, 5, 10])];
    const ends = segmentEndsMm(moves, 'cut');
    // The scrubber rests at 1.0, which must show everything — a reveal that
    // hid one trailing segment at rest would read as a gap in the path.
    expect(revealedSegmentCount(ends, 10)).toBe(ends.length);
  });

  it('agrees with a linear scan for any position (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 500, noNaN: true }), { minLength: 0, maxLength: 40 }),
        fc.double({ min: -10, max: 510, noNaN: true }),
        (values, atMm) => {
          const ends = [...values].sort((a, b) => a - b);
          const scanned = ends.filter((end) => end <= atMm).length;
          expect(revealedSegmentCount(ends, atMm)).toBe(scanned);
        },
      ),
    );
  });

  it('produces a non-decreasing list, which the binary search depends on', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            lengthMm: fc.double({ min: 0, max: 50, noNaN: true }),
            points: fc.array(fc.double({ min: -20, max: 20, noNaN: true }), {
              minLength: 2,
              maxLength: 6,
            }),
          }),
          { minLength: 1, maxLength: 12 },
        ),
        (specs) => {
          let startMm = 0;
          const moves = specs.map((spec) => {
            const built = move('cut', startMm, spec.lengthMm, spec.points);
            startMm += spec.lengthMm;
            return built;
          });
          const ends = segmentEndsMm(moves, 'cut');
          for (let index = 1; index < ends.length; index += 1) {
            expect(ends[index] ?? 0).toBeGreaterThanOrEqual(ends[index - 1] ?? 0);
          }
        },
      ),
    );
  });
});
