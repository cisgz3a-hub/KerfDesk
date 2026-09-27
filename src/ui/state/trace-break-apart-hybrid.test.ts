import { describe, expect, it } from 'vitest';
import type { ColoredPath, Polyline, TracedImage } from '../../core/scene';
import { HYBRID_FILL_COLOR, HYBRID_STROKE_COLOR } from '../../core/trace/hybrid/hybrid-paths';
import { splitTracedImage } from './trace-break-apart';

// ADR-454: Break Apart on a Line + fill trace splits each stroke into its own
// shape (a closed stroke inside another is a separate mark), while each fill
// outline keeps its holes.

function square(x: number, y: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  };
}

function hybridTrace(paths: ReadonlyArray<ColoredPath>): TracedImage {
  return {
    kind: 'traced-image',
    id: 'trace',
    source: 'logo.png',
    traceMode: 'hybrid',
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotationDeg: 0, mirrorX: false, mirrorY: false },
    paths,
  };
}

describe('Break Apart on a Line + fill trace', () => {
  it('gives each stroke its own shape and keeps a fill outline with its hole', () => {
    const fill: ColoredPath = {
      color: HYBRID_FILL_COLOR,
      polylines: [square(0, 0, 40), square(10, 10, 20)],
    };
    // Two closed strokes, one inside the other: marks, not a ring with a hole.
    const strokes: ColoredPath = {
      color: HYBRID_STROKE_COLOR,
      strokeWidthMm: 2,
      polylines: [square(50, 50, 40), square(60, 60, 20)],
    };
    const pieces = splitTracedImage(hybridTrace([fill, strokes]), (i) => `part_${i + 1}`);

    expect(pieces.map((piece) => piece.paths[0]?.polylines.length)).toEqual([2, 1, 1]);
    expect(pieces[0]?.paths[0]?.color).toBe(HYBRID_FILL_COLOR);
    expect(pieces.slice(1).map((piece) => piece.paths[0]?.color)).toEqual([
      HYBRID_STROKE_COLOR,
      HYBRID_STROKE_COLOR,
    ]);
    // Each stroke piece keeps its pen width and the Line + fill mode.
    expect(pieces.slice(1).map((piece) => piece.paths[0]?.strokeWidthMm)).toEqual([2, 2]);
    expect(pieces.every((piece) => piece.traceMode === 'hybrid')).toBe(true);
  });
});
