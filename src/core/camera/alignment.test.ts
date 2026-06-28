import { describe, expect, it } from 'vitest';
import { addAlignmentPoint, beginAlignment, type AlignmentState } from './alignment';
import { applyHomography } from './homography';

const TARGETS = [
  { x: 0, y: 0 },
  { x: 200, y: 0 },
  { x: 200, y: 150 },
  { x: 0, y: 150 },
];

// Four clicked pixels in a y-down frame that should calibrate to TARGETS.
const PIXELS = [
  { x: 40, y: 380 },
  { x: 600, y: 360 },
  { x: 610, y: 30 },
  { x: 30, y: 50 },
];

function collect(
  targets: typeof TARGETS,
  pixels: ReadonlyArray<{ x: number; y: number }>,
): AlignmentState {
  return pixels.reduce<AlignmentState>(
    (state, pixel) => addAlignmentPoint(state, pixel),
    beginAlignment(targets),
  );
}

describe('alignment state machine', () => {
  it('stays collecting until one point per target is in', () => {
    let state = beginAlignment(TARGETS);
    expect(state.kind).toBe('collecting');
    for (let i = 0; i < 3; i += 1) {
      state = addAlignmentPoint(state, PIXELS[i]!);
      expect(state.kind).toBe('collecting');
      if (state.kind === 'collecting') expect(state.pixels).toHaveLength(i + 1);
    }
  });

  it('solves a valid 4-point set into a homography that maps pixels to targets', () => {
    const state = collect(TARGETS, PIXELS);
    expect(state.kind).toBe('aligned');
    if (state.kind === 'aligned') {
      for (let i = 0; i < TARGETS.length; i += 1) {
        const mapped = applyHomography(state.homography, PIXELS[i]!);
        expect(mapped.x).toBeCloseTo(TARGETS[i]!.x, 6);
        expect(mapped.y).toBeCloseTo(TARGETS[i]!.y, 6);
      }
    }
  });

  it('fails on a degenerate (collinear) click set', () => {
    const collinear = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 20 },
      { x: 30, y: 30 },
    ];
    const state = collect(TARGETS, collinear);
    expect(state.kind).toBe('failed');
    if (state.kind === 'failed') expect(state.reason).toBe('degenerate');
  });

  it('ignores points added when not collecting', () => {
    const idle: AlignmentState = { kind: 'idle' };
    expect(addAlignmentPoint(idle, { x: 1, y: 2 })).toBe(idle);
    const aligned = collect(TARGETS, PIXELS);
    expect(addAlignmentPoint(aligned, { x: 1, y: 2 })).toBe(aligned);
  });
});
