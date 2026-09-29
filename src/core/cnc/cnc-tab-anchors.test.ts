import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  IDENTITY_TRANSFORM,
  type CncTabAnchor,
  type CurveSubpath,
  type ImportedSvg,
  type Vec2,
} from '../scene';
import {
  closedCurveNodeFraction,
  closingLineFraction,
  cncTabAnchorPosition,
  projectCncTabAnchor,
  redistributeCncTabAnchors,
  restartedTabAnchors,
  seedCncTabAnchors,
} from './cnc-tab-anchors';

const OBJECT: ImportedSvg = {
  kind: 'imported-svg',
  id: 'part',
  source: 'part.svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
        },
      ],
    },
  ],
};

describe('CNC tab anchors', () => {
  it('keeps dragged anchors when the editor is reopened with a different count', () => {
    const object = {
      ...OBJECT,
      cncTabAnchors: [{ layerColor: '#ff0000', pathIndex: 0, polylineIndex: 0, pathT: 0.3 }],
    };
    expect(seedCncTabAnchors(object, '#ff0000', 6)).toBe(object.cncTabAnchors);
  });

  it('redistributes only saved eligible contours and preserves same-color sibling paths', () => {
    const path = OBJECT.paths[0]!;
    const protectedAnchor = { layerColor: path.color, pathIndex: 1, polylineIndex: 0, pathT: 0.3 };
    const object = {
      ...OBJECT,
      paths: [{ ...path, polylines: [...path.polylines, ...path.polylines] }, path],
      cncTabAnchors: [
        { layerColor: path.color, pathIndex: 0, polylineIndex: 0, pathT: 0.05 },
        protectedAnchor,
      ],
    };
    const anchors = redistributeCncTabAnchors(object, new Set([0]), 3);
    expect(
      anchors.filter((anchor) => anchor.pathIndex === 0).map((anchor) => anchor.pathT),
    ).toEqual([1 / 6, 0.5, 5 / 6]);
    expect(anchors.filter((anchor) => anchor.pathIndex === 1)).toEqual([protectedAnchor]);
    expect(anchors.some((anchor) => anchor.polylineIndex === 1)).toBe(false);
    expect(object.cncTabAnchors).toHaveLength(2);
  });

  it('preserves automatic, open and stale contour anchors without inventing replacements', () => {
    expect(redistributeCncTabAnchors(OBJECT, new Set([0]), 6)).toEqual([]);
    const path = OBJECT.paths[0]!;
    const object = {
      ...OBJECT,
      paths: [
        { ...path, polylines: path.polylines.map((polyline) => ({ ...polyline, closed: false })) },
      ],
      cncTabAnchors: [
        { layerColor: path.color, pathIndex: 0, polylineIndex: 0, pathT: 0.3 },
        { layerColor: path.color, pathIndex: 0, polylineIndex: 99, pathT: 0.5 },
      ],
    };
    expect(redistributeCncTabAnchors(object, new Set([0]), 6)).toBe(object.cncTabAnchors);
  });

  it('seeds normalized positions and keeps them attached through transforms', () => {
    const anchors = seedCncTabAnchors(OBJECT, '#ff0000', 4);
    expect(anchors.map((anchor) => anchor.pathT)).toEqual([0.125, 0.375, 0.625, 0.875]);
    const moved = { ...OBJECT, transform: { ...IDENTITY_TRANSFORM, x: 20, y: 30 } };
    expect(cncTabAnchorPosition(moved, anchors[0]!)).toEqual({ x: 25, y: 30 });
  });

  it('projects a dragged point to the nearest contour position', () => {
    const anchor = projectCncTabAnchor(OBJECT, '#ff0000', { x: 12, y: 5 });
    expect(anchor).toMatchObject({ pathIndex: 0, polylineIndex: 0 });
    expect(anchor?.pathT).toBeCloseTo(0.375, 6);
    expect(cncTabAnchorPosition(OBJECT, anchor!)).toEqual({ x: 10, y: 5 });
  });

  it.each([
    { scaleX: 2, scaleY: 2 },
    { scaleX: 2, scaleY: 1 },
    { scaleX: 0.5, scaleY: 3 },
    { scaleX: 2, scaleY: 1, mirrorX: true, rotationDeg: 37 },
    { scaleX: -2, scaleY: 1, mirrorY: true, rotationDeg: 90 },
  ])('persists the local edge position through transform %j', (changes) => {
    const transform = { ...IDENTITY_TRANSFORM, x: 50, y: 70, ...changes };
    const object = { ...OBJECT, transform };
    const anchor = projectCncTabAnchor(
      object,
      '#ff0000',
      applyTransform({ x: 12, y: 5 }, transform),
    );
    expect(anchor?.pathT).toBeCloseTo(0.375, 9);
    const actual = cncTabAnchorPosition(object, anchor!);
    const expected = applyTransform({ x: 10, y: 5 }, transform);
    expect(actual?.x).toBeCloseTo(expected.x, 9);
    expect(actual?.y).toBeCloseTo(expected.y, 9);
  });

  it.each([0, 37])('chooses the nearest edge in scene space after rotation %s', (rotationDeg) => {
    const transform = {
      ...IDENTITY_TRANSFORM,
      x: 200,
      y: 100,
      scaleX: 10,
      scaleY: 1,
      mirrorX: true,
      rotationDeg,
    };
    const object = { ...OBJECT, transform };
    // Locally the left edge is nearest (2 mm); on screen the bottom edge is
    // nearest (4 mm versus 20 mm). The saved fraction still uses local lengths.
    const anchor = projectCncTabAnchor(
      object,
      '#ff0000',
      applyTransform({ x: 2, y: 4 }, transform),
    );
    expect(anchor?.pathT).toBeCloseTo(0.05, 9);
    const actual = cncTabAnchorPosition(object, anchor!);
    const expected = applyTransform({ x: 2, y: 0 }, transform);
    expect(actual?.x).toBeCloseTo(expected.x, 9);
    expect(actual?.y).toBeCloseTo(expected.y, 9);
  });
});

// The node tool's Start and Break redraw a closed contour from a node; tabs
// placed by hand stay where they were (ADR-494 Amendment 1).
describe('tab anchors on a contour restarted at a node', () => {
  const [a, b, c, d] = [p(0, 0), p(40, 0), p(40, 20), p(0, 20)] as const;

  it('measures a node as the fraction of the outline that pathT counts', () => {
    const repeated = lines(a, [b, c, d, a]);
    const fractions = [0, 1, 2, 3, 4].map((node) => closedCurveNodeFraction(repeated, node));
    [0, 1 / 3, 0.5, 5 / 6, 1].forEach((want, node) =>
      expect(fractions[node]).toBeCloseTo(want, 12),
    );
    // Closed by an implied line from d back to a: d is the last node.
    const implied = lines(a, [b, c, d]);
    expect(closedCurveNodeFraction(implied, 3)).toBeCloseTo(5 / 6, 12);
    expect(closedCurveNodeFraction(implied, 4)).toBeNull();
    expect(closedCurveNodeFraction({ ...repeated, closed: false }, 2)).toBeNull();
    expect(closedCurveNodeFraction(repeated, -1)).toBeNull();
    expect(closedCurveNodeFraction(repeated, 1.5)).toBeNull();
  });

  it('counts the whole way to a node that passes back through the start', () => {
    // Two triangles meeting at the start: node 3 is the start again, halfway round.
    const bowTie = lines(a, [p(10, 0), p(10, 10), a, p(-10, 0), p(-10, -10), a]);
    expect(closedCurveNodeFraction(bowTie, 3)).toBeCloseTo(0.5, 12);
  });

  it('moves each anchor on the restarted contour back by the start and leaves the rest', () => {
    const anchor = (pathT: number): CncTabAnchor => ({
      layerColor: '#ff0000',
      pathIndex: 0,
      polylineIndex: 0,
      pathT,
    });
    const otherContour = { ...anchor(0.75), polylineIndex: 1 };
    const otherPath = { ...anchor(0.75), pathIndex: 1 };
    const anchors = [anchor(0.75), anchor(0.25), anchor(0), anchor(1), anchor(1.5)];
    const moved = restartedTabAnchors([...anchors, otherContour, otherPath], 0, 0, 0.25);
    expect(moved.map((placed) => placed.pathT)).toEqual([0.5, 0, 0.75, 0.75, 0.75, 0.75, 0.75]);
    expect(moved[5]).toBe(otherContour);
    expect(moved[6]).toBe(otherPath);
    // A place a rounding step short of a whole turn is the start, not 1.
    expect(restartedTabAnchors([anchor(0.1)], 0, 0, 0.1 + 1e-17)[0]?.pathT).toBe(0);
  });

  it('measures the straight line that would close an open contour as a share of its length', () => {
    const path = (closed: boolean, points: ReadonlyArray<Vec2>) => ({
      color: '#ff0000',
      polylines: [{ closed, points }],
    });
    // Broken at c: c, d, a, b runs 100 mm and the line from b back to c is 20 mm.
    expect(closingLineFraction(path(false, [c, d, a, b]), 0)).toBeCloseTo(1 / 6, 12);
    expect(closingLineFraction(path(false, [a, b, c, d, a]), 0)).toBe(0);
    expect(closingLineFraction(path(true, [a, b, c, d]), 0)).toBe(0);
    expect(closingLineFraction(path(false, [a, a]), 0)).toBeNull();
    expect(closingLineFraction(path(false, [a, b]), 1)).toBeNull();
  });
});

function p(x: number, y: number): Vec2 {
  return { x, y };
}

function lines(start: Vec2, ends: ReadonlyArray<Vec2>): CurveSubpath {
  return { start, closed: true, segments: ends.map((to) => ({ kind: 'line', to })) };
}
