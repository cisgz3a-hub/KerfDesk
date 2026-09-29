import { describe, expect, it } from 'vitest';
import type { CubicPathSegment, CurveSubpath, Vec2 } from '../../core/scene';
import { importLightBurnProject } from './lbrn-import';

// Shapes LightBurn writes other than VertList/PrimList Beziers (ADR-388): a
// Rect's corner radius `Cr`, a PrimList of `LineClosed`, and the `<V>` / `<P>`
// path elements of a legacy .lbrn project. Placed on the default 400 x 400 bed
// from a front-left origin, a project point (X, Y) lands at (X, 400 - Y).

function opened(xml: string, name = 'shapes.lbrn2') {
  const result = importLightBurnProject(xml, name);
  if (!result.ok) throw new Error(result.reason);
  const curves = result.project.scene.objects.flatMap((object) =>
    object.kind === 'imported-svg' ? object.paths.flatMap((path) => path.curves ?? []) : [],
  );
  return { curves, warnings: result.report.warnings };
}

const project = (shapes: string) =>
  `<LightBurnProject AppVersion="1.7.08" FormatVersion="1">${shapes}</LightBurnProject>`;
const rect = (attributes: string) =>
  project(`<Shape Type="Rect" CutIndex="0" ${attributes}><XForm>1 0 0 1 100 100</XForm></Shape>`);
const NO_HANDLES = 'c0x1c1x1';
const TRIANGLE = `<VertList>V0 0${NO_HANDLES}V20 0${NO_HANDLES}V10 15${NO_HANDLES}</VertList>`;

describe('LightBurn rectangles', () => {
  it('rounds each corner of a Rect with Cr into a true arc of that radius', () => {
    // 50 x 30 around (100, 100), so (100, 300) on the bed.
    const { curves, warnings } = opened(rect('W="50" H="30" Cr="5"'));
    expect(warnings).toEqual([]);
    const outline = only(curves);
    expect(outline.closed).toBe(true);
    expect(kindCounts(outline)).toEqual({ line: 4, cubic: 4 });
    const centres = [
      { x: 80, y: 290 },
      { x: 120, y: 290 },
      { x: 120, y: 310 },
      { x: 80, y: 310 },
    ];
    expect(arcRadii(outline, centres)).toEqual([5, 5, 5, 5]);
    expect(extent(outline)).toEqual({ minX: 75, minY: 285, maxX: 125, maxY: 315 });
  });

  it('draws a radius past half the shorter side as half that side', () => {
    // Cr 40 on a 30 mm tall Rect: the ends become half circles of radius 15.
    const outline = only(opened(rect('W="50" H="30" Cr="40"')).curves);
    expect(kindCounts(outline)).toEqual({ line: 2, cubic: 4 });
    expect(
      arcRadii(outline, [
        { x: 90, y: 300 },
        { x: 110, y: 300 },
      ]),
    ).toEqual([15, 15, 15, 15]);
  });

  it('keeps square corners when Cr is 0 or absent', () => {
    for (const attributes of ['W="50" H="30" Cr="0"', 'W="50" H="30"']) {
      const outline = only(opened(rect(attributes)).curves);
      expect(kindCounts(outline)).toEqual({ line: 4 });
      expect(extent(outline)).toEqual({ minX: 75, minY: 285, maxX: 125, maxY: 315 });
    }
  });
});

describe('LightBurn line lists', () => {
  it('joins every vertex of a LineClosed path in order and closes it', () => {
    const { curves, warnings } = opened(
      project(
        `<Shape Type="Path" CutIndex="0"><XForm>1 0 0 1 0 0</XForm>${TRIANGLE}<PrimList>LineClosed</PrimList></Shape>`,
      ),
    );
    expect(warnings).toEqual([]);
    const triangle = only(curves);
    expect(triangle.closed).toBe(true);
    expect(kinds(triangle)).toEqual(['line', 'line', 'line']);
    expect(points(triangle)).toEqual([
      { x: 0, y: 400 },
      { x: 20, y: 400 },
      { x: 10, y: 385 },
      { x: 0, y: 400 },
    ]);
  });

  it('reads a LineClosed list that a later shape shares by PrimID', () => {
    const { curves } = opened(
      project(
        `<Shape Type="Path" CutIndex="0" VertID="4" PrimID="4"><XForm>1 0 0 1 0 0</XForm>${TRIANGLE}<PrimList>LineClosed</PrimList></Shape>
         <Shape Type="Path" CutIndex="0" VertID="4" PrimID="4"><XForm>1 0 0 1 50 0</XForm></Shape>`,
      ),
    );
    expect(curves.map((curve) => [curve.start, curve.closed])).toEqual([
      [{ x: 0, y: 400 }, true],
      [{ x: 50, y: 400 }, true],
    ]);
  });

  it('leaves a LineOpen path open', () => {
    const polyline = only(
      opened(
        project(
          `<Shape Type="Path" CutIndex="0"><XForm>1 0 0 1 0 0</XForm>${TRIANGLE}<PrimList>LineOpen</PrimList></Shape>`,
        ),
      ).curves,
    );
    expect(polyline.closed).toBe(false);
    expect(kinds(polyline)).toEqual(['line', 'line']);
  });
});

describe('legacy .lbrn paths', () => {
  it('opens a circle written as V and P elements as a true circle', () => {
    // Radius 25 around (50, 50), each quarter a B primitive between vertices.
    const { curves, warnings } = opened(
      `<LightBurnProject AppVersion="0.9.06" FormatVersion="0"><Shape Type="Path" CutIndex="1"><XForm>1 0 0 1 50 50</XForm>
        <V vx="25" vy="0" c0x="25" c0y="-13.807117" c1x="25" c1y="13.807117"/>
        <V vx="0" vy="-25" c0x="-13.807117" c0y="-25" c1x="13.807117" c1y="-25"/>
        <V vx="-25" vy="0" c0x="-25" c0y="13.807117" c1x="-25" c1y="-13.807117"/>
        <V vx="0" vy="25" c0x="13.807117" c0y="25" c1x="-13.807117" c1y="25"/>
        <P T="B" p0="0" p1="1"/><P T="B" p0="1" p1="2"/><P T="B" p0="2" p1="3"/><P T="B" p0="3" p1="0"/>
      </Shape></LightBurnProject>`,
      'legacy.lbrn',
    );
    expect(warnings).toEqual([]);
    const circle = only(curves);
    expect(circle.closed).toBe(true);
    expect(kinds(circle)).toEqual(['cubic', 'cubic', 'cubic', 'cubic']);
    expect(arcRadii(circle, [{ x: 50, y: 350 }])).toEqual([25, 25, 25, 25]);
  });

  it('opens legacy line primitives', () => {
    const square = only(
      opened(
        `<LightBurnProject AppVersion="0.9.06" FormatVersion="0"><Shape Type="Path" CutIndex="0"><XForm>1 0 0 1 0 0</XForm>
          <V vx="0" vy="0"/><V vx="10" vy="0"/><V vx="10" vy="10"/><V vx="0" vy="10"/>
          <P T="L" p0="0" p1="1"/><P T="L" p0="1" p1="2"/><P T="L" p0="2" p1="3"/><P T="L" p0="3" p1="0"/>
        </Shape></LightBurnProject>`,
        'legacy.lbrn',
      ).curves,
    );
    expect(square.closed).toBe(true);
    expect(points(square)).toEqual([
      { x: 0, y: 400 },
      { x: 10, y: 400 },
      { x: 10, y: 390 },
      { x: 0, y: 390 },
      { x: 0, y: 400 },
    ]);
  });
});

function only(curves: ReadonlyArray<CurveSubpath>): CurveSubpath {
  expect(curves).toHaveLength(1);
  return curves[0] as CurveSubpath;
}

function kinds(curve: CurveSubpath): string[] {
  return curve.segments.map((segment) => segment.kind);
}

function kindCounts(curve: CurveSubpath): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const kind of kinds(curve)) counts[kind] = (counts[kind] ?? 0) + 1;
  return counts;
}

function points(curve: CurveSubpath): Vec2[] {
  return [curve.start, ...curve.segments.map((segment) => segment.to)];
}

function cubicsOf(curve: CurveSubpath): Array<readonly [Vec2, CubicPathSegment]> {
  const cubics: Array<readonly [Vec2, CubicPathSegment]> = [];
  let from = curve.start;
  for (const segment of curve.segments) {
    if (segment.kind === 'cubic') cubics.push([from, segment]);
    from = segment.to;
  }
  return cubics;
}

// Each cubic's radius about the nearest centre, checked along its whole length
// to within the 0.03 % a quarter circle drawn as one cubic keeps to.
function arcRadii(curve: CurveSubpath, centres: ReadonlyArray<Vec2>): number[] {
  return cubicsOf(curve).map(([from, arc]) => {
    const middle = cubicPoint(from, arc, 0.5);
    const centre = [...centres].sort(
      (left, right) => distance(left, middle) - distance(right, middle),
    )[0] as Vec2;
    const radius = distance(from, centre);
    for (const point of samples(from, arc)) {
      expect(Math.abs(distance(point, centre) - radius)).toBeLessThan(radius * 3e-4);
    }
    return Number(radius.toFixed(6));
  });
}

function extent(curve: CurveSubpath) {
  const xs = points(curve).map((point) => point.x);
  const ys = points(curve).map((point) => point.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function samples(from: Vec2, arc: CubicPathSegment): Vec2[] {
  return Array.from({ length: 11 }, (_, step) => cubicPoint(from, arc, step / 10));
}

function distance(left: Vec2, right: Vec2): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function cubicPoint(from: Vec2, segment: CubicPathSegment, t: number): Vec2 {
  const u = 1 - t;
  const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return {
    x: a * from.x + b * segment.control1.x + c * segment.control2.x + d * segment.to.x,
    y: a * from.y + b * segment.control1.y + c * segment.control2.y + d * segment.to.y,
  };
}
