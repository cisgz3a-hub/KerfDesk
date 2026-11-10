import { describe, expect, it } from 'vitest';
import { SEG_KIND } from '../../core/gcode-view';
import { timelineBands, timelineBandsGradient } from './timeline-bands';

function program(kinds: ReadonlyArray<number>, ends: ReadonlyArray<number>) {
  return {
    model: { segmentCount: kinds.length, segKind: Uint8Array.from(kinds) },
    ends: Float32Array.from(ends),
  };
}

describe('timelineBands', () => {
  it('splits the time into cut and travel bands by where the seconds go', () => {
    const { model, ends } = program(
      [SEG_KIND.travel, SEG_KIND.cut, SEG_KIND.travel, SEG_KIND.cut],
      [1, 6, 7, 10],
    );
    expect(timelineBands(model, ends, 10, 10)).toEqual([
      { kind: 'travel', from: 0, to: 0.1 },
      { kind: 'cut', from: 0.1, to: 0.6 },
      { kind: 'travel', from: 0.6, to: 0.7 },
      { kind: 'cut', from: 0.7, to: 1 },
    ]);
  });

  it('gives a shared bin to the kind that spent longest in it', () => {
    // Bin 0 holds 0.3 s of travel and 0.7 s of cut.
    const { model, ends } = program([SEG_KIND.travel, SEG_KIND.cut], [0.3, 2]);
    expect(timelineBands(model, ends, 2, 2)).toEqual([{ kind: 'cut', from: 0, to: 1 }]);
  });

  it('groups plunges and retracts as other moves', () => {
    const { model, ends } = program([SEG_KIND.plunge, SEG_KIND.retract], [1, 2]);
    expect(timelineBands(model, ends, 2, 2)).toEqual([{ kind: 'other', from: 0, to: 1 }]);
  });

  it('has no bands without motion time', () => {
    const { model, ends } = program([SEG_KIND.cut], [0]);
    expect(timelineBands(model, ends, 0)).toEqual([]);
    expect(timelineBandsGradient([])).toBeUndefined();
  });

  it('writes the bands as hard-edged gradient stops in the viewer colours', () => {
    expect(
      timelineBandsGradient([
        { kind: 'travel', from: 0, to: 0.25 },
        { kind: 'cut', from: 0.25, to: 1 },
      ]),
    ).toBe(
      'linear-gradient(to right, var(--lf-viewer-band-travel) 0% 25%, var(--lf-viewer-band-cut) 25% 100%)',
    );
  });
});
