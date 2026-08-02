import { describe, expect, it } from 'vitest';
import { designPointSequenceHint } from './design-point-sequence-hint';

const sequenceWith = (count: number) => ({
  kind: 'path' as const,
  points: Array.from({ length: count }, (_value, index) => ({ x: index * 10, y: 0 })),
  pointerMm: { x: count * 10, y: 0 },
});

describe('designPointSequenceHint', () => {
  it('explains each Polyline phase without implying an inert click', () => {
    expect(designPointSequenceHint(sequenceWith(1))).toContain('First corner set');
    expect(designPointSequenceHint(sequenceWith(2))).toContain('double-click to finish open');
    expect(designPointSequenceHint(sequenceWith(3))).toContain('click the start to close');
  });

  it('explains the Arc centre and start phases', () => {
    expect(
      designPointSequenceHint({
        kind: 'arc',
        centerMm: { x: 10, y: 10 },
        startMm: null,
        pointerMm: { x: 20, y: 10 },
      }),
    ).toContain('Centre set');
    expect(
      designPointSequenceHint({
        kind: 'arc',
        centerMm: { x: 10, y: 10 },
        startMm: { x: 20, y: 10 },
        pointerMm: { x: 10, y: 20 },
      }),
    ).toContain('Start set');
  });
});
