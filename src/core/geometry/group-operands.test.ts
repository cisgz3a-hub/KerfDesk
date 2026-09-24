// Group operands (ADR-377): a selected group is one shape in Weld, Union and
// the Boolean tools, and the Boolean subject is the first operand given.

import { areaPathsD, FillRule, intersectD, type PathsD } from 'clipper2-ts';
import { describe, expect, it } from 'vitest';
import type { Result } from '../result';
import { IDENTITY_TRANSFORM, type ImportedSvg, type SceneGroup } from '../scene';
import { combineVectorObjects } from './vector-path-booleans';
import type { VectorOpError } from './vector-path-tools';
import { unionVectorObjects } from './vector-path-union';
import { weldVectorObjects } from './vector-path-weld';

type Point = { readonly x: number; readonly y: number };

function polygonObject(id: string, points: ReadonlyArray<Point>, color = '#ff0000'): ImportedSvg {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    kind: 'imported-svg',
    id,
    source: id,
    bounds: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color, polylines: [{ closed: true, points: [...points] }] }],
  };
}

function circlePoints(radius: number, segments = 96): ReadonlyArray<Point> {
  return Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  });
}

function starPoints(outerRadius: number, innerRadius: number): ReadonlyArray<Point> {
  return Array.from({ length: 10 }, (_, index) => {
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    const angle = Math.PI / 2 + (index / 10) * Math.PI * 2;
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  });
}

function squarePoints(x0: number, y0: number, x1: number, y1: number): ReadonlyArray<Point> {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

function pathsOf(points: ReadonlyArray<Point>): PathsD {
  return [[...points]];
}

function area(paths: PathsD): number {
  return Math.abs(areaPathsD(paths));
}

function resultArea(result: Result<ImportedSvg, VectorOpError>): number {
  if (result.kind === 'error') throw new Error(result.error.message);
  return Math.abs(
    areaPathsD(
      result.value.paths.flatMap((path) => path.polylines.map((polyline) => [...polyline.points])),
    ),
  );
}

function group(id: string, objectIds: ReadonlyArray<string>): SceneGroup {
  return { id, name: id, objectIds: [...objectIds] };
}

const OUTER = circlePoints(20);
const INNER = circlePoints(10);
const RING_AREA = area(pathsOf(OUTER)) - area(pathsOf(INNER));

describe('combineVectorObjects with group operands', () => {
  it('intersects a donut group with a star to give the star inside the ring', () => {
    const outer = polygonObject('outer', OUTER);
    const inner = polygonObject('inner', INNER);
    const star = polygonObject('star', starPoints(25, 12), '#0000ff');
    const donut = group('donut', ['outer', 'inner']);

    // The star's inner radius (12) clears the hole (10), so the hole lies
    // wholly inside the star and the answer is star-inside-outer minus the hole.
    const starInsideOuter = area(
      intersectD(pathsOf(starPoints(25, 12)), pathsOf(OUTER), FillRule.NonZero, 3),
    );
    const expected = starInsideOuter - area(pathsOf(INNER));

    const grouped = combineVectorObjects([outer, inner, star], 'intersect', 'out', [donut]);
    expect(resultArea(grouped)).toBeCloseTo(expected, 1);
    const starFirst = combineVectorObjects([star, outer, inner], 'intersect', 'out', [donut]);
    expect(resultArea(starFirst)).toBeCloseTo(expected, 1);

    // Without the group each circle is its own operand, so only the hole's
    // disc is common to all three shapes.
    const ungrouped = combineVectorObjects([outer, inner, star], 'intersect', 'out');
    expect(resultArea(ungrouped)).toBeCloseTo(area(pathsOf(INNER)), 1);
  });

  it('keeps a first-selected group and subtracts the later shape from it', () => {
    const outer = polygonObject('outer', OUTER);
    const inner = polygonObject('inner', INNER);
    const bar = polygonObject('bar', squarePoints(-30, -2, 30, 2), '#00ff00');

    const result = combineVectorObjects([outer, inner, bar], 'subtract', 'out', [
      group('donut', ['outer', 'inner']),
    ]);

    // The bar crosses the ring twice, each crossing about 10 mm long and 4 mm high.
    expect(resultArea(result)).toBeCloseTo(RING_AREA - 2 * 10 * 4, 0);
    if (result.kind === 'ok') expect(result.value.paths[0]?.color).toBe('#ff0000');
  });

  it('subtracts a later-selected group as one shape, leaving its hole in place', () => {
    const plate = polygonObject('plate', squarePoints(-30, -30, 30, 30), '#00ff00');
    const outer = polygonObject('outer', OUTER);
    const inner = polygonObject('inner', INNER);

    const result = combineVectorObjects([plate, outer, inner], 'subtract', 'out', [
      group('donut', ['outer', 'inner']),
    ]);

    expect(resultArea(result)).toBeCloseTo(3600 - RING_AREA, 1);
    if (result.kind === 'ok') expect(result.value.paths[0]?.color).toBe('#00ff00');
  });

  it('counts one group as one operand', () => {
    const outer = polygonObject('outer', OUTER);
    const inner = polygonObject('inner', INNER);

    const result = combineVectorObjects([outer, inner], 'subtract', 'out', [
      group('donut', ['outer', 'inner']),
    ]);

    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.error.kind).toBe('too-few-objects');
  });
});

describe('Weld and Union with group operands', () => {
  const outer = polygonObject('outer', OUTER);
  const inner = polygonObject('inner', INNER);
  const donut = group('donut', ['outer', 'inner']);
  // Overlaps the ring on the right without reaching the hole.
  const tab = polygonObject('tab', squarePoints(15, -3, 30, 3));
  const TAB_OUTSIDE_RING = area(pathsOf(squarePoints(15, -3, 30, 3))) - tabInsideOuter();

  it('keeps a grouped donut hole open when welding it to another shape', () => {
    const welded = weldVectorObjects([outer, inner, tab], 'out', [donut]);

    expect(resultArea(welded)).toBeCloseTo(RING_AREA + TAB_OUTSIDE_RING, 1);
    if (welded.kind === 'ok') expect(welded.value.paths[0]?.polylines).toHaveLength(2);
  });

  it('welds ungrouped circles shut, as before', () => {
    const welded = weldVectorObjects([outer, inner, tab], 'out');

    expect(resultArea(welded)).toBeCloseTo(area(pathsOf(OUTER)) + TAB_OUTSIDE_RING, 1);
    if (welded.kind === 'ok') expect(welded.value.paths[0]?.polylines).toHaveLength(1);
  });

  it('keeps the hole in a Union silhouette of a grouped donut', () => {
    const operation = { id: 'cut', color: '#ff0000' };

    const grouped = unionVectorObjects([outer, inner, tab], operation, 'out', [donut]);
    const ungrouped = unionVectorObjects([outer, inner, tab], operation, 'out');

    expect(resultArea(grouped)).toBeCloseTo(RING_AREA + TAB_OUTSIDE_RING, 1);
    expect(resultArea(ungrouped)).toBeCloseTo(area(pathsOf(OUTER)) + TAB_OUTSIDE_RING, 1);
  });
});

function tabInsideOuter(): number {
  return area(
    intersectD(pathsOf(squarePoints(15, -3, 30, 3)), pathsOf(OUTER), FillRule.NonZero, 3),
  );
}
