import { describe, expect, it } from 'vitest';
import { SEG_KIND } from '../../core/gcode-view';
import { MARKER_MIN_RADIUS_MM, markerRadiusMm } from './marker-radius';
import type { Viewer3dSegmentsInput } from './segment-buckets';

/** A closed rectangle from (x0,y0) to (x1,y1) at Z=0, as four cut segments. */
function rectangle(x0: number, y0: number, x1: number, y1: number): Viewer3dSegmentsInput {
  const corners: readonly (readonly [number, number])[] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const positions = new Float32Array(corners.length * 6);
  for (let index = 0; index < corners.length; index += 1) {
    const [ax, ay] = corners[index] ?? [0, 0];
    const [bx, by] = corners[(index + 1) % corners.length] ?? [0, 0];
    positions.set([ax, ay, 0, bx, by, 0], index * 6);
  }
  return {
    segmentCount: corners.length,
    positions,
    segKind: new Uint8Array(corners.length).fill(SEG_KIND.cut),
  };
}

describe('markerRadiusMm', () => {
  it('sizes a tall narrow job the same as the wide short job it is a rotation of', () => {
    // The same 400x20 program in both orientations. Sampling only X made the
    // rotated copy 12x smaller (4.80mm vs a clamped 0.40mm).
    const wide = markerRadiusMm(rectangle(0, 0, 400, 20));
    const tall = markerRadiusMm(rectangle(0, 0, 20, 400));
    expect(wide).toBeCloseTo(4.8, 6);
    expect(tall).toBeCloseTo(wide, 6);
  });

  it('sizes an offset job by its extent, not its distance from the origin', () => {
    // A 20mm square parked far down the bed is still a 20mm job.
    const atOrigin = markerRadiusMm(rectangle(0, 0, 20, 20));
    const offset = markerRadiusMm(rectangle(800, 0, 820, 20));
    expect(offset).toBeCloseTo(atOrigin, 6);
    expect(offset).toBeCloseTo(MARKER_MIN_RADIUS_MM, 6);
  });

  it('measures a job straddling the origin across its full width', () => {
    // -200..200 is a 400mm job; max-absolute-coordinate read it as 200.
    expect(markerRadiusMm(rectangle(-200, -10, 200, 10))).toBeCloseTo(4.8, 6);
  });

  it('measures depth when Z is the largest extent', () => {
    // A plunge-dominant program is flat in XY but 100mm deep.
    const plunge = {
      segmentCount: 1,
      positions: new Float32Array([0, 0, 0, 0, 0, -100]),
      segKind: new Uint8Array([SEG_KIND.plunge]),
    };
    expect(markerRadiusMm(plunge)).toBeCloseTo(1.2, 6);
  });

  it('falls back to the minimum radius for an empty program', () => {
    const empty = {
      segmentCount: 0,
      positions: new Float32Array(0),
      segKind: new Uint8Array(0),
    };
    expect(markerRadiusMm(empty)).toBe(MARKER_MIN_RADIUS_MM);
  });
});
