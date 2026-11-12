// Audit L4-P3-1 (rolling v7): a rotated copy turns with the guide's true
// tangent, not the chord of its 0.025 mm flattening, while real corners keep
// edge-aligned copies (ADR-498 decision 4).

import { describe, expect, it } from 'vitest';
import type { ArrayPlacement } from '../scene/array-layout';
import {
  IDENTITY_TRANSFORM,
  type Bounds,
  type CubicPathSegment,
  type ImportedSvg,
  type SceneObject,
  type Transform,
  type Vec2,
} from '../scene/scene-object';
import { applyTransform } from '../scene/transform';
import { createEllipse } from '../shapes/primitives/create-ellipse';
import { createRectangle } from '../shapes/primitives/create-rectangle';
import { copyAlongPathLayout, type CopyAlongPathSpec } from './copy-along-path';
import { splitCopyAlongPathSelection, type CopyAlongPathGuide } from './copy-along-path-guide';

// A 4 × 2 mm artwork centred on the origin, so a placement's dx/dy is the
// point on the guide where the copy's centre lands.
const SOURCE: Bounds = { minX: -2, minY: -1, maxX: 2, maxY: 1 };
const ARTWORK: ImportedSvg = {
  kind: 'imported-svg',
  id: 'art',
  source: 'art.svg',
  bounds: SOURCE,
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: -2, y: 0 },
            { x: 2, y: 0 },
          ],
        },
        {
          closed: false,
          points: [
            { x: 0, y: -1 },
            { x: 0, y: 1 },
          ],
        },
      ],
    },
  ],
};
const SPEC: CopyAlongPathSpec = {
  mode: 'count',
  count: 12,
  spacingMm: 10,
  startOffsetMm: 0,
  endOffsetMm: 0,
  rotateCopies: true,
};
// The audit's bar: chords leaned 0.9° to 5.7°; the true tangent is far inside this.
const MAX_LEAN_DEG = 0.05;
// The Circle tool draws a circle as four quarter cubics, whose own tangent
// swings up to about 0.072° off a perfect circle's at any radius (measured).
// Copies follow that canonical curve, so they get this much room.
const MAX_FOUR_CUBIC_LEAN_DEG = 0.08;

function guideOf(object: SceneObject): CopyAlongPathGuide {
  const selection = splitCopyAlongPathSelection([ARTWORK, object], object.id);
  if (selection.kind !== 'ok') throw new Error(`expected a guide, got ${selection.kind}`);
  return selection.guide;
}

// A true circle: two SVG half-circle arcs round (r, r), starting on the right.
function arcCircle(radius: number, transform: Transform = IDENTITY_TRANSFORM): SceneObject {
  const half = {
    kind: 'elliptical-arc',
    radiusX: radius,
    radiusY: radius,
    rotationDeg: 0,
  } as const;
  const right = { x: radius * 2, y: radius };
  const left = { x: 0, y: radius };
  return {
    kind: 'imported-svg',
    id: `arc-circle-${radius}`,
    source: 'circle.svg',
    bounds: { minX: 0, minY: 0, maxX: radius * 2, maxY: radius * 2 },
    transform,
    paths: [
      {
        color: '#000000',
        polylines: [{ closed: true, points: [right, left] }],
        curves: [
          {
            start: right,
            segments: [
              { ...half, largeArc: false, sweep: true, to: left },
              { ...half, largeArc: false, sweep: true, to: right },
            ],
            closed: true,
          },
        ],
      },
    ],
  };
}

// The Circle tool's circle: four quarter cubics.
function circle(radius: number, transform: Transform = IDENTITY_TRANSFORM): SceneObject {
  return createEllipse({
    id: `circle-${radius}`,
    color: '#000000',
    spec: { widthMm: radius * 2, heightMm: radius * 2 },
    transform,
  });
}

function placements(
  guide: CopyAlongPathGuide,
  patch: Partial<CopyAlongPathSpec> = {},
): ReadonlyArray<ArrayPlacement> {
  const result = copyAlongPathLayout(guide, SOURCE, { ...SPEC, ...patch });
  if (result.kind !== 'placed') throw new Error(`expected copies, got ${result.kind}`);
  return result.placements;
}

function degrees(direction: Vec2): number {
  return (Math.atan2(direction.y, direction.x) * 180) / Math.PI;
}

function angleBetween(a: number, b: number): number {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

// The largest angle between a copy's turn and the circle's tangent at its
// point, travelling the way the copies run round the centre.
function maxCircleLean(copies: ReadonlyArray<ArrayPlacement>, centre: Vec2): number {
  const first = copies[0];
  const second = copies[1];
  if (first === undefined || second === undefined) throw new Error('need two copies');
  const turn = Math.sign(
    (first.dx - centre.x) * (second.dy - centre.y) - (first.dy - centre.y) * (second.dx - centre.x),
  );
  return copies.reduce((worst, copy) => {
    const radial = degrees({ x: copy.dx - centre.x, y: copy.dy - centre.y });
    return Math.max(worst, angleBetween(copy.rotationDeg, radial + turn * 90));
  }, 0);
}

describe('Copy Along Path rotation on a curved guide', () => {
  it.each([5, 10, 50])('turns 12 copies with the tangent of an r %d arc circle', (radius) => {
    const guide = guideOf(arcCircle(radius));
    expect(guide.curve).toBeDefined();
    const centre = { x: radius, y: radius };
    expect(maxCircleLean(placements(guide), centre)).toBeLessThan(MAX_LEAN_DEG);
    // Copies between flattened vertices too, not only on them.
    const dense = placements(guide, { count: 97, startOffsetMm: 0.37 });
    expect(maxCircleLean(dense, centre)).toBeLessThan(MAX_LEAN_DEG);
  });

  it.each([5, 10, 50])('turns copies with the Circle tool r %d circle', (radius) => {
    const guide = guideOf(circle(radius));
    expect(guide.curve).toBeDefined();
    const centre = { x: radius, y: radius };
    expect(maxCircleLean(placements(guide), centre)).toBeLessThan(MAX_FOUR_CUBIC_LEAN_DEG);
    const dense = placements(guide, { count: 97, startOffsetMm: 0.37 });
    expect(maxCircleLean(dense, centre)).toBeLessThan(MAX_FOUR_CUBIC_LEAN_DEG);
  });

  it('leaned with the chord before the fix', () => {
    const { curve: _curve, ...chordsOnly } = guideOf(circle(5));
    const centre = { x: 5, y: 5 };
    const dense = copyAlongPathLayout(chordsOnly, SOURCE, {
      ...SPEC,
      count: 97,
      startOffsetMm: 0.37,
    });
    if (dense.kind !== 'placed') throw new Error('expected copies');
    expect(maxCircleLean(dense.placements, centre)).toBeGreaterThan(1);
  });

  it('follows the tangent through a rotated, mirrored and scaled circle', () => {
    const transform: Transform = {
      ...IDENTITY_TRANSFORM,
      x: 30,
      y: -12,
      scaleX: 2,
      scaleY: 2,
      rotationDeg: 33,
      mirrorX: true,
    };
    const guide = guideOf(arcCircle(10, transform));
    const centre = applyTransform({ x: 10, y: 10 }, transform);
    const copies = placements(guide, { count: 41, startOffsetMm: 1.3 });
    expect(maxCircleLean(copies, centre)).toBeLessThan(MAX_LEAN_DEG);
  });

  it('follows the tangent of an open cubic, end copy included', () => {
    const start = { x: 0, y: 0 };
    const cubic: CubicPathSegment = {
      kind: 'cubic',
      control1: { x: 10, y: 25 },
      control2: { x: 30, y: -20 },
      to: { x: 40, y: 5 },
    };
    const wave: ImportedSvg = {
      kind: 'imported-svg',
      id: 'wave',
      source: 'wave.svg',
      bounds: { minX: 0, minY: -10, maxX: 40, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        {
          color: '#000000',
          polylines: [{ closed: false, points: [start, cubic.to] }],
          curves: [{ start, segments: [cubic], closed: false }],
        },
      ],
    };
    const copies = placements(guideOf(wave), { count: 23 });
    for (const copy of copies) {
      const expected = degrees(cubicTangentNearest(start, cubic, { x: copy.dx, y: copy.dy }));
      expect(angleBetween(copy.rotationDeg, expected)).toBeLessThan(MAX_LEAN_DEG);
    }
  });
});

describe('Copy Along Path rotation at real corners', () => {
  it('keeps copies edge-aligned on a rectangle guide, corners included', () => {
    const frame = createRectangle({
      id: 'frame',
      color: '#000000',
      spec: { widthMm: 40, heightMm: 40, cornerRadiusMm: 0 },
    });
    const guide = guideOf(frame);
    const onCorners = placements(guide, { count: 4 }).map((copy) => copy.rotationDeg);
    const alongEdges = placements(guide, { count: 8, startOffsetMm: 10 }).map(
      (copy) => copy.rotationDeg,
    );
    for (const angle of [...onCorners, ...alongEdges]) expect(angle % 90).toBe(0);
    // A copy on a corner takes the edge leaving it: four corners, four directions.
    expect(new Set(onCorners).size).toBe(4);
  });
});

// Independent oracle: the nearest of 200,001 evenly spaced curve points, and
// the Bezier derivative there.
function cubicTangentNearest(from: Vec2, segment: CubicPathSegment, point: Vec2): Vec2 {
  const p = [from, segment.control1, segment.control2, segment.to] as const;
  let bestT = 0;
  let best = Number.POSITIVE_INFINITY;
  const steps = 200_000;
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const u = 1 - t;
    const x =
      u * u * u * p[0].x + 3 * u * u * t * p[1].x + 3 * u * t * t * p[2].x + t ** 3 * p[3].x;
    const y =
      u * u * u * p[0].y + 3 * u * u * t * p[1].y + 3 * u * t * t * p[2].y + t ** 3 * p[3].y;
    const distance = (x - point.x) ** 2 + (y - point.y) ** 2;
    if (distance < best) {
      best = distance;
      bestT = t;
    }
  }
  const u = 1 - bestT;
  return {
    x:
      3 * u * u * (p[1].x - p[0].x) +
      6 * u * bestT * (p[2].x - p[1].x) +
      3 * bestT ** 2 * (p[3].x - p[2].x),
    y:
      3 * u * u * (p[1].y - p[0].y) +
      6 * u * bestT * (p[2].y - p[1].y) +
      3 * bestT ** 2 * (p[3].y - p[2].y),
  };
}
