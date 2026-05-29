// Tests for the tracedata → ColoredPath conversion. We test the pure
// `tracedataToColoredPaths` directly with synthetic tracedata fixtures,
// so we don't have to spin up imagetracerjs to verify the geometry.
//
// Two things are easy to get wrong here and matter a lot for engrave
// quality:
//   1. Q-segment sampling — too few samples and the curve looks like a
//      hexagon. We verify the sample count and that a known-shape Q
//      lands within tolerance of the analytic Bezier formula.
//   2. Background skipping — the white layer is always dropped, so a
//      black-on-white binary trace produces exactly one ColoredPath.

import { describe, expect, it } from 'vitest';

import {
  type PaletteEntry,
  type TraceData,
  type TracePath,
  tracedataToColoredPaths,
} from './trace-to-paths';

// Typed tracedata builder. Mirrors the imagetracerjs JSON shape but
// uses our exported types so the test stays in sync with the
// production typing.
function makeTracedata(
  layers: ReadonlyArray<ReadonlyArray<TracePath>>,
  palette: ReadonlyArray<PaletteEntry>,
): TraceData {
  return { layers, palette };
}

describe('tracedataToColoredPaths', () => {
  it('returns [] for empty tracedata', () => {
    expect(tracedataToColoredPaths(makeTracedata([], []))).toEqual([]);
  });

  it('skips the white background layer', () => {
    const td = makeTracedata(
      [
        [{ segments: [{ type: 'L', x1: 0, y1: 0, x2: 10, y2: 10 }] }],
        [{ segments: [{ type: 'L', x1: 5, y1: 5, x2: 6, y2: 6 }] }],
      ],
      [
        { r: 255, g: 255, b: 255 }, // white — should be skipped
        { r: 0, g: 0, b: 0 }, // black — should be kept
      ],
    );
    const result = tracedataToColoredPaths(td);
    expect(result).toHaveLength(1);
    expect(result[0]?.color).toBe('#000000');
  });

  it('emits one Polyline per path with linear segments', () => {
    const td = makeTracedata(
      [
        [
          {
            segments: [
              { type: 'L', x1: 0, y1: 0, x2: 10, y2: 0 },
              { type: 'L', x1: 10, y1: 0, x2: 10, y2: 10 },
              { type: 'L', x1: 10, y1: 10, x2: 0, y2: 10 },
              { type: 'L', x1: 0, y1: 10, x2: 0, y2: 0 },
            ],
          },
        ],
      ],
      [{ r: 0, g: 0, b: 0 }],
    );
    const result = tracedataToColoredPaths(td);
    expect(result).toHaveLength(1);
    const path = result[0];
    expect(path?.polylines).toHaveLength(1);
    // 4 segments × 1 endpoint each = 4 + the initial start = 5 points.
    const points = path?.polylines[0]?.points ?? [];
    expect(points).toHaveLength(5);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[4]).toEqual({ x: 0, y: 0 });
  });

  it('marks emitted polylines as closed (every imagetracerjs path is)', () => {
    const td = makeTracedata(
      [[{ segments: [{ type: 'L', x1: 0, y1: 0, x2: 5, y2: 5 }] }]],
      [{ r: 0, g: 0, b: 0 }],
    );
    const result = tracedataToColoredPaths(td);
    expect(result[0]?.polylines[0]?.closed).toBe(true);
  });

  it('samples a Q (quadratic Bezier) at the expected density', () => {
    const td = makeTracedata(
      [
        [
          {
            segments: [{ type: 'Q', x1: 0, y1: 0, x2: 5, y2: 10, x3: 10, y3: 0 }],
          },
        ],
      ],
      [{ r: 0, g: 0, b: 0 }],
    );
    const result = tracedataToColoredPaths(td);
    const points = result[0]?.polylines[0]?.points ?? [];
    // 1 start point + 16 samples per Q = 17.
    expect(points).toHaveLength(17);
    // First point is the start of the Q.
    expect(points[0]).toEqual({ x: 0, y: 0 });
    // Last point is the end of the Q (t = 1).
    expect(points[16]?.x).toBeCloseTo(10, 6);
    expect(points[16]?.y).toBeCloseTo(0, 6);
  });

  it('Q midpoint sample matches the analytic Bezier formula', () => {
    // For this Q, B(0.5) = 0.25*P0 + 0.5*P1 + 0.25*P2.
    // P0 = (0,0), P1 = (5,10), P2 = (10,0) → B(0.5) = (5, 5).
    const td = makeTracedata(
      [
        [
          {
            segments: [{ type: 'Q', x1: 0, y1: 0, x2: 5, y2: 10, x3: 10, y3: 0 }],
          },
        ],
      ],
      [{ r: 0, g: 0, b: 0 }],
    );
    const result = tracedataToColoredPaths(td);
    const points = result[0]?.polylines[0]?.points ?? [];
    // 1 start + 16 samples → midpoint sample is at index 8 (t = 8/16 = 0.5).
    expect(points[8]?.x).toBeCloseTo(5, 6);
    expect(points[8]?.y).toBeCloseTo(5, 6);
  });

  it('drops paths with fewer than 2 points (degenerate)', () => {
    const td = makeTracedata([[{ segments: [] }]], [{ r: 0, g: 0, b: 0 }]);
    const result = tracedataToColoredPaths(td);
    expect(result).toEqual([]);
  });

  it('produces one ColoredPath per non-background colour', () => {
    const td = makeTracedata(
      [
        [
          {
            segments: [
              { type: 'L', x1: 0, y1: 0, x2: 10, y2: 0 },
              { type: 'L', x1: 10, y1: 0, x2: 0, y2: 0 },
            ],
          },
        ],
        [
          {
            segments: [
              { type: 'L', x1: 0, y1: 0, x2: 10, y2: 0 },
              { type: 'L', x1: 10, y1: 0, x2: 0, y2: 0 },
            ],
          },
        ],
        [
          {
            segments: [
              { type: 'L', x1: 0, y1: 0, x2: 10, y2: 0 },
              { type: 'L', x1: 10, y1: 0, x2: 0, y2: 0 },
            ],
          },
        ],
      ],
      [
        { r: 255, g: 255, b: 255 }, // white, skipped
        { r: 0, g: 0, b: 0 }, // black
        { r: 128, g: 64, b: 32 }, // brown
      ],
    );
    const result = tracedataToColoredPaths(td);
    expect(result).toHaveLength(2);
    expect(result[0]?.color).toBe('#000000');
    expect(result[1]?.color).toBe('#804020');
  });

  it('hex byte conversion pads single-digit values to two digits', () => {
    const td = makeTracedata(
      [
        [
          {
            segments: [
              { type: 'L', x1: 0, y1: 0, x2: 1, y2: 1 },
              { type: 'L', x1: 1, y1: 1, x2: 0, y2: 0 },
            ],
          },
        ],
      ],
      [{ r: 5, g: 10, b: 15 }], // → '#050a0f'
    );
    const result = tracedataToColoredPaths(td);
    expect(result[0]?.color).toBe('#050a0f');
  });
});
