import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import {
  DEFAULT_LINE_ART_CONTOURS,
  lineArtSelectionApplies,
  selectLineArtContours,
} from './line-art-contours';

const BIT_MM = 3.175;

function square(at: number, size: number, closed = true): Polyline {
  return {
    closed,
    points: [
      { x: at, y: at },
      { x: at + size, y: at },
      { x: at + size, y: at + size },
      { x: at, y: at + size },
    ],
  };
}

// The job111 field case: a traced stroke arrives as two nested outlines less
// than a stroke-width apart (0.72 mm gap on a 3.175 mm bit).
const OUTER = square(0, 40);
const INNER = square(0.72, 40 - 2 * 0.72);

describe('selectLineArtContours', () => {
  it('keeps only the inner edge of a tight traced pair by default', () => {
    expect(selectLineArtContours([OUTER, INNER], DEFAULT_LINE_ART_CONTOURS, BIT_MM)).toEqual([
      INNER,
    ]);
  });

  it('keeps only the outer edge when asked', () => {
    expect(selectLineArtContours([OUTER, INNER], 'outer', BIT_MM)).toEqual([OUTER]);
  });

  it("returns the input array unchanged for 'both' (byte-identity)", () => {
    const input = [OUTER, INNER];
    expect(selectLineArtContours(input, 'both', BIT_MM)).toBe(input);
  });

  it('never drops a lone contour — a single traced shape always cuts', () => {
    expect(selectLineArtContours([INNER], 'inner', BIT_MM)).toEqual([INNER]);
    expect(selectLineArtContours([INNER], 'outer', BIT_MM)).toEqual([INNER]);
  });

  it('leaves washer-style nesting alone: gaps wider than the bit are real walls', () => {
    const washerOuter = square(0, 40);
    const washerInner = square(10, 20); // 10 mm wall >> 3.175 mm bit
    expect(selectLineArtContours([washerOuter, washerInner], 'inner', BIT_MM)).toEqual([
      washerOuter,
      washerInner,
    ]);
  });

  it('keeps open polylines regardless of the selection', () => {
    const open = square(0.72, 40 - 2 * 0.72, false);
    expect(selectLineArtContours([OUTER, open], 'inner', BIT_MM)).toEqual([OUTER, open]);
  });

  it('does not pair side-by-side shapes that never nest', () => {
    const left = square(0, 20);
    const right = square(30, 20);
    expect(selectLineArtContours([left, right], 'inner', BIT_MM)).toEqual([left, right]);
  });

  it('does not pair a child hugging only one side of a much larger parent', () => {
    // Figure-eight-style lobe: tight on the left edge, far from the right.
    const outer = square(0, 40);
    const lobe: Polyline = {
      closed: true,
      points: [
        { x: 1, y: 1 },
        { x: 15, y: 1 },
        { x: 15, y: 39 },
        { x: 1, y: 39 },
      ],
    };
    expect(selectLineArtContours([outer, lobe], 'inner', BIT_MM)).toEqual([outer, lobe]);
  });

  it('keeps the innermost / outermost edge of a triple-line nest', () => {
    const a = square(0, 40);
    const b = square(1, 38);
    const c = square(2, 36);
    expect(selectLineArtContours([a, b, c], 'inner', BIT_MM)).toEqual([c]);
    expect(selectLineArtContours([a, b, c], 'outer', BIT_MM)).toEqual([a]);
  });

  it('selects independently per ring pair in the same layer', () => {
    const heartOuter = square(0, 40);
    const heartInner = square(0.72, 40 - 2 * 0.72);
    const starOuter = square(100, 30);
    const starInner = square(100.72, 30 - 2 * 0.72);
    expect(
      selectLineArtContours([heartOuter, heartInner, starOuter, starInner], 'inner', BIT_MM),
    ).toEqual([heartInner, starInner]);
  });
});

describe('lineArtSelectionApplies', () => {
  it('applies to edge-following cut types only', () => {
    expect(lineArtSelectionApplies('profile-outside')).toBe(true);
    expect(lineArtSelectionApplies('profile-inside')).toBe(true);
    expect(lineArtSelectionApplies('profile-on-path')).toBe(true);
    expect(lineArtSelectionApplies('engrave')).toBe(true);
    expect(lineArtSelectionApplies('pocket')).toBe(false);
    expect(lineArtSelectionApplies('v-carve')).toBe(false);
    expect(lineArtSelectionApplies('inlay-pair')).toBe(false);
    expect(lineArtSelectionApplies('drill')).toBe(false);
  });
});
