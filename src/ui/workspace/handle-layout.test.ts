// Which resize handles a selection box offers at its size on screen, and
// where a press belongs to the body instead (annoyance audit A2 B6-P2-6;
// ADR-196 Amendment 1).

import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type SceneObject } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { hitHandle, visibleHandlesFor } from './handles';
import { hitAabbHandle, visibleAabbHandlePoints } from './selection-handles';

function square(sizeMm: number, rotationDeg = 0): SceneObject {
  return createRectangle({
    id: 'square',
    color: '#000000',
    spec: { widthMm: sizeMm, heightMm: sizeMm, cornerRadiusMm: 0 },
    transform: { ...IDENTITY_TRANSFORM, x: 100, y: 100, rotationDeg },
  });
}

function flatLine(lengthMm: number): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'line',
    source: 'line.svg',
    bounds: { minX: 0, minY: 0, maxX: lengthMm, maxY: 0 },
    transform: { ...IDENTITY_TRANSFORM, x: 100, y: 100 },
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: lengthMm, y: 0 },
            ],
          },
        ],
      },
    ],
  };
}

const kinds = (handles: ReadonlyArray<{ readonly kind: string }>): string[] =>
  handles.map((handle) => handle.kind).sort();

const ALL = ['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w'];
const CORNERS = ['ne', 'nw', 'se', 'sw'];

describe('the handles a single object shows', () => {
  // A 10 mm square is 5, 10, 20, 24 and 40 px across at these scales.
  it.each([
    [2, CORNERS],
    [1, CORNERS],
    [0.5, CORNERS],
    [10 / 24, ALL],
    [0.25, ALL],
  ])('at %f mm per px', (pxToMm, expected) => {
    expect(kinds(visibleHandlesFor(square(10), pxToMm))).toEqual(expected);
  });

  it('keeps a side handle only where it clears its twin across a thin box', () => {
    const thin = createRectangle({
      id: 'thin',
      color: '#000000',
      spec: { widthMm: 100, heightMm: 6, cornerRadiusMm: 0 },
      transform: IDENTITY_TRANSFORM,
    });
    // 100 x 6 px: top and bottom middles would overlap; the ends are crowded.
    expect(kinds(visibleHandlesFor(thin, 1))).toEqual(CORNERS);
    // 200 x 12 px: top and bottom clear each other; the ends are still crowded.
    expect(kinds(visibleHandlesFor(thin, 0.5))).toEqual(['n', 'ne', 'nw', 's', 'se', 'sw']);
    expect(kinds(visibleHandlesFor(thin, 0.25))).toEqual(ALL);
  });

  it('gives a straight line its two ends at every zoom', () => {
    for (const pxToMm of [4, 1, 0.25, 0.01]) {
      expect(kinds(visibleHandlesFor(flatLine(50), pxToMm))).toEqual(['e', 'w']);
    }
  });
});

describe('a press on a single small object', () => {
  it.each([2, 1, 0.5])('belongs to the body inside the box at %f mm per px', (pxToMm) => {
    const object = square(10);
    // One pixel inside each corner, and the middle of each side.
    for (const [x, y] of [
      [100 + pxToMm, 100 + pxToMm],
      [110 - pxToMm, 100 + pxToMm],
      [110 - pxToMm, 110 - pxToMm],
      [105, 100 + pxToMm],
      [105, 105],
    ] as const) {
      expect(hitHandle(object, { x, y }, pxToMm), `at ${x}, ${y}`).toBeNull();
    }
  });

  it.each([2, 1, 0.5])('takes the corner from just outside at %f mm per px', (pxToMm) => {
    const object = square(10);
    const out = 2 * pxToMm;
    expect(hitHandle(object, { x: 100 - out, y: 100 - out }, pxToMm)).toBe('nw');
    expect(hitHandle(object, { x: 110 + out, y: 100 - out }, pxToMm)).toBe('ne');
    expect(hitHandle(object, { x: 110 + out, y: 110 + out }, pxToMm)).toBe('se');
    expect(hitHandle(object, { x: 100 - out, y: 110 + out }, pxToMm)).toBe('sw');
  });

  it('keeps every handle whole on a box with room for them', () => {
    const object = square(10);
    const pxToMm = 0.25;
    expect(hitHandle(object, { x: 100 + pxToMm, y: 100 + pxToMm }, pxToMm)).toBe('nw');
    expect(hitHandle(object, { x: 105, y: 100 + pxToMm }, pxToMm)).toBe('n');
    expect(hitHandle(object, { x: 105, y: 105 }, pxToMm)).toBeNull();
  });

  it('measures inside and outside along a turned box', () => {
    // Turned 45 degrees about its top-left corner, the square's centre is
    // straight below that corner.
    const object = square(10, 45);
    const pxToMm = 1;
    const centre = { x: 100, y: 100 + 5 * Math.SQRT2 };
    expect(hitHandle(object, centre, pxToMm)).toBeNull();
    expect(hitHandle(object, { x: 100, y: 100 + 1.5 }, pxToMm)).toBeNull();
    expect(hitHandle(object, { x: 100, y: 100 - 2 }, pxToMm)).toBe('nw');
  });
});

describe('a press on a straight line', () => {
  it.each([1, 0.25, 0.05])('takes no handle at its middle at %f mm per px', (pxToMm) => {
    const object = flatLine(50);
    expect(hitHandle(object, { x: 125, y: 100 }, pxToMm)).toBeNull();
    expect(hitHandle(object, { x: 125, y: 100 + 3 * pxToMm }, pxToMm)).toBeNull();
  });

  it('takes the end handles at its ends', () => {
    const object = flatLine(50);
    expect(hitHandle(object, { x: 150, y: 100 }, 0.25)).toBe('e');
    expect(hitHandle(object, { x: 100, y: 100 }, 0.25)).toBe('w');
  });

  it('gives a line too short for both handles to the body between its ends', () => {
    // 6 px long: the two end handles would cover all of it.
    const object = flatLine(6);
    expect(hitHandle(object, { x: 103, y: 100 }, 1)).toBeNull();
    expect(hitHandle(object, { x: 101, y: 101 }, 1)).toBeNull();
    expect(hitHandle(object, { x: 108, y: 100 }, 1)).toBe('e');
    expect(hitHandle(object, { x: 98, y: 100 }, 1)).toBe('w');
  });
});

describe('a multi-selection box', () => {
  const small = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

  it('shows the same handles as a single object of its size', () => {
    expect(kinds(visibleAabbHandlePoints(small, 1))).toEqual(CORNERS);
    expect(kinds(visibleAabbHandlePoints(small, 0.25))).toEqual(ALL);
    const flat = { minX: 0, minY: 5, maxX: 50, maxY: 5 };
    expect(kinds(visibleAabbHandlePoints(flat, 0.25))).toEqual(['e', 'w']);
  });

  it('leaves the inside of a small box to the body', () => {
    expect(hitAabbHandle(small, { x: 1, y: 1 }, 1)).toBeNull();
    expect(hitAabbHandle(small, { x: 5, y: 5 }, 1)).toBeNull();
    expect(hitAabbHandle(small, { x: -2, y: -2 }, 1)).toBe('nw');
    expect(hitAabbHandle(small, { x: 12, y: 12 }, 1)).toBe('se');
    expect(hitAabbHandle(small, { x: 0.25, y: 0.25 }, 0.25)).toBe('nw');
  });

  it('picks the nearest of two handles that overlap', () => {
    // A 2 px box: every corner handle covers the point (3, 3) px.
    const tiny = { minX: 0, minY: 0, maxX: 2, maxY: 2 };
    expect(hitAabbHandle(tiny, { x: 3, y: 3 }, 1)).toBe('se');
    expect(hitAabbHandle(tiny, { x: -1, y: 3 }, 1)).toBe('sw');
  });
});
