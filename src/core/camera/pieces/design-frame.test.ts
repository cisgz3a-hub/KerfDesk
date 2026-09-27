import { describe, expect, it } from 'vitest';
import { pointInPolygon } from '../../geometry';
import {
  applyTransform,
  combinedBBox,
  IDENTITY_TRANSFORM,
  type ArrayPlacement,
  type SceneObject,
} from '../../scene';
import { designFrame } from './design-frame';
import type { DetectedPiece } from './find-pieces';
import { piecePlacements } from './piece-placements';
import type { Point } from './rotated-rect';

// An 80 × 20 mm artwork turned by `rotationDeg` about its own origin at (x, y).
function artwork(id: string, x: number, y: number, rotationDeg: number, mirrorX = false) {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 80, maxY: 20 },
    transform: { ...IDENTITY_TRANSFORM, x, y, rotationDeg, mirrorX },
    paths: [],
  } satisfies SceneObject;
}

// A 100 × 40 mm blank at (200, 100) whose long side runs at `axisDeg`.
function blank(axisDeg: number): DetectedPiece {
  const rad = (axisDeg * Math.PI) / 180;
  const corner = (a: number, b: number): Point => ({
    x: 200 + a * 50 * Math.cos(rad) - b * 20 * Math.sin(rad),
    y: 100 + a * 50 * Math.sin(rad) + b * 20 * Math.cos(rad),
  });
  return {
    outline: [corner(1, 1), corner(-1, 1), corner(-1, -1), corner(1, -1)],
    rect: { centre: { x: 200, y: 100 }, axisDeg, length: 100, width: 40 },
    areaMm2: 4000,
    centroid: { x: 200, y: 100 },
    shape: 'oblong',
    headingDeg: null,
    partial: false,
  };
}

// Where a design point lands: moved, then turned about the pivot.
function land(point: Point, placement: ArrayPlacement): Point {
  const moved = { x: point.x + placement.dx, y: point.y + placement.dy };
  const pivot = placement.pivot;
  if (pivot === undefined) return moved;
  const rad = (placement.rotationDeg * Math.PI) / 180;
  const dx = moved.x - pivot.x;
  const dy = moved.y - pivot.y;
  return {
    x: pivot.x + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: pivot.y + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

function pageCorners(object: SceneObject): Point[] {
  const { minX, minY, maxX, maxY } = object.bounds;
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ].map((corner) => applyTransform(corner, object.transform));
}

describe('designFrame', () => {
  it('reads a turned artwork in its own frame', () => {
    const art = artwork('art', 40, 250, 30);
    const frame = designFrame([art]);
    expect(frame?.turnDeg).toBe(30);
    expect(frame?.width).toBeCloseTo(80);
    expect(frame?.height).toBeCloseTo(20);
    const centre = applyTransform({ x: 40, y: 10 }, art.transform);
    expect(frame?.centre.x).toBeCloseTo(centre.x);
    expect(frame?.centre.y).toBeCloseTo(centre.y);
  });

  it('shares a frame between objects turned by whole quarter turns', () => {
    const frame = designFrame([artwork('a', 0, 0, 30), artwork('b', 200, 0, 120)]);
    expect(frame?.turnDeg).toBe(30);
  });

  it('uses the page frame for unturned or mixed selections, as before', () => {
    const objects = [artwork('a', 0, 0, 0), artwork('b', 100, 50, 30)];
    const frame = designFrame(objects);
    const box = combinedBBox(objects);
    expect(frame?.turnDeg).toBe(0);
    expect(frame?.width).toBeCloseTo((box?.maxX ?? 0) - (box?.minX ?? 0));
    expect(frame?.height).toBeCloseTo((box?.maxY ?? 0) - (box?.minY ?? 0));
    expect(designFrame([])).toBeNull();
  });
});

describe('placing turned artwork on a blank', () => {
  it.each([
    [0, 0],
    [30, 0],
    [60, 0],
    [90, 0],
    [135, 0],
    [-20, 25],
    [60, 100],
  ])('lands a design turned %s° wholly on a blank at %s°', (turnDeg, axisDeg) => {
    for (const mirrorX of [false, true]) {
      const art = artwork('art', 40, 250, turnDeg, mirrorX);
      const frame = designFrame([art]);
      if (frame === null) throw new Error('no frame');
      const piece = blank(axisDeg);
      const [placement] = piecePlacements({ pieces: [piece], design: frame, sample: null });
      if (placement === undefined) throw new Error('no placement');
      for (const corner of pageCorners(art)) {
        expect(pointInPolygon(land(corner, placement), piece.outline)).toBe(true);
      }
    }
  });
});
