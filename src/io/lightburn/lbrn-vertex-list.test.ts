import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CubicPathSegment, CurveSubpath, Vec2 } from '../../core/scene';
import { importLightBurnProject } from './lbrn-import';
import { parseLbrnVertexList } from './lbrn-vertex-list';

// Real LightBurn 2.0.05 file: its group holds a rounded outline (5 mm and 1 mm
// fillets) and four 1.6 mm circles, all written as VertList/PrimList Beziers.
const KEYPAD = readFileSync(
  resolve(
    process.cwd(),
    'src/__fixtures__/lightburn/external/lbrn/acwright-keypad-helper-top.lbrn2',
  ),
  'utf8',
);

describe('parseLbrnVertexList', () => {
  it('reads c0 as the outgoing handle and c1 as the incoming one', () => {
    const [vertex] = parseLbrnVertexList(
      'V-4.4000015 6c0x-4.4000015c0y6.8836555c1x-4.4000015c1y5.1163445',
    );
    expect(vertex).toEqual({
      point: { x: -4.4000015, y: 6 },
      outgoing: { x: -4.4000015, y: 6.8836555 },
      incoming: { x: -4.4000015, y: 5.1163445 },
    });
  });

  it('fills an omitted zero coordinate and treats a bare x1 as no handle', () => {
    expect(parseLbrnVertexList('V-5 0c0x-2.2385712c1x1V0 5c0x1c1y2.2385788')).toEqual([
      { point: { x: -5, y: 0 }, outgoing: { x: -2.2385712, y: 0 } },
      { point: { x: 0, y: 5 }, incoming: { x: 0, y: 2.2385788 } },
    ]);
  });

  it('keeps a handle whose x is 1 when its y is written', () => {
    expect(parseLbrnVertexList('V0 0c0x1c0y2c1x1')).toEqual([
      { point: { x: 0, y: 0 }, outgoing: { x: 1, y: 2 } },
    ]);
  });

  it('reads numbers written with an exponent, as float noise near zero is', () => {
    expect(
      parseLbrnVertexList('V-1.1368684e-13 5c0x2.5E-7c0y1e+2c1x1V10 4.2632564e-14c0x1c1x1V10 10'),
    ).toEqual([
      { point: { x: -1.1368684e-13, y: 5 }, outgoing: { x: 2.5e-7, y: 100 } },
      { point: { x: 10, y: 4.2632564e-14 } },
      { point: { x: 10, y: 10 } },
    ]);
  });
});

describe('LightBurn 2 paths with float noise', () => {
  it('keeps every corner of a square whose corner is written with an exponent', () => {
    const result = importLightBurnProject(
      `<LightBurnProject><Shape Type="Path" CutIndex="0"><XForm>1 0 0 1 0 0</XForm>
        <VertList>V-1.1368684e-13 0c0x1c1x1V10 0c0x1c1x1V10 10c0x1c1x1V0 10c0x1c1x1</VertList>
        <PrimList>L0 1L1 2L2 3L3 0</PrimList></Shape></LightBurnProject>`,
      'noise.lbrn2',
    );
    if (!result.ok) throw new Error(result.reason);
    const [square] = result.project.scene.objects;
    const curve = square?.kind === 'imported-svg' ? square.paths[0]?.curves?.[0] : undefined;
    expect([curve?.closed, curve?.segments.length]).toEqual([true, 4]);
    expect(square?.kind === 'imported-svg' && square.bounds).toEqual({
      minX: -1.1368684e-13,
      minY: 390,
      maxX: 10,
      maxY: 400,
    });
  });
});

describe('LightBurn 2 Bezier paths from a real project', () => {
  const curves = keypadCurves();

  it('imports every 1.6 mm circle as a circle along the whole curve', () => {
    const circles = curves.filter(
      (curve) => curve.segments.length === 4 && curve.segments.every(isCubic),
    );
    expect(circles).toHaveLength(4);
    for (const circle of circles) {
      const centre = centroid(anchors(circle));
      for (const distance of sampledDistances(circle, () => centre)) {
        expect(Math.abs(distance - 1.6)).toBeLessThan(0.002);
      }
    }
  });

  it('keeps every rounded corner of the outline a true arc, not a chamfer', () => {
    const outline = curves.find((curve) => curve.segments.length === 16);
    if (outline === undefined) throw new Error('outline missing');
    let from = outline.start;
    const radii: number[] = [];
    for (const segment of outline.segments) {
      if (segment.kind === 'cubic') {
        const radius = Math.hypot(segment.to.x - from.x, segment.to.y - from.y) / Math.SQRT2;
        const centre = quarterArcCentre(from, segment, radius);
        for (const distance of sampledDistances(
          { start: from, segments: [segment], closed: false },
          () => centre,
        )) {
          expect(Math.abs(distance - radius)).toBeLessThan(0.003);
        }
        radii.push(Number(radius.toFixed(3)));
      }
      from = segment.to;
    }
    expect(radii).toEqual([5, 1, 1, 1, 1, 5, 5, 5]);
  });
});

function keypadCurves(): CurveSubpath[] {
  const result = importLightBurnProject(KEYPAD, 'acwright-keypad-helper-top.lbrn2');
  if (!result.ok) throw new Error(result.reason);
  return result.project.scene.objects.flatMap((object) =>
    object.kind === 'imported-svg' ? object.paths.flatMap((path) => path.curves ?? []) : [],
  );
}

function isCubic(segment: CurveSubpath['segments'][number]): segment is CubicPathSegment {
  return segment.kind === 'cubic';
}

function anchors(curve: CurveSubpath): Vec2[] {
  return curve.segments.map((segment) => segment.to);
}

function centroid(points: ReadonlyArray<Vec2>): Vec2 {
  const sum = points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), {
    x: 0,
    y: 0,
  });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

// The centre of a 90 degree arc lies across the chord from the curve's bulge.
function quarterArcCentre(from: Vec2, segment: CubicPathSegment, radius: number): Vec2 {
  const middle = { x: (from.x + segment.to.x) / 2, y: (from.y + segment.to.y) / 2 };
  const bulge = cubicPoint(from, segment, 0.5);
  const away = { x: middle.x - bulge.x, y: middle.y - bulge.y };
  const length = Math.hypot(away.x, away.y);
  const reach = radius / Math.SQRT2;
  return { x: middle.x + (away.x / length) * reach, y: middle.y + (away.y / length) * reach };
}

function sampledDistances(curve: CurveSubpath, centreOf: () => Vec2): number[] {
  const centre = centreOf();
  const distances: number[] = [];
  let from = curve.start;
  for (const segment of curve.segments) {
    if (segment.kind !== 'cubic') throw new Error(`expected a cubic, got ${segment.kind}`);
    for (let step = 0; step <= 10; step += 1) {
      const point = cubicPoint(from, segment, step / 10);
      distances.push(Math.hypot(point.x - centre.x, point.y - centre.y));
    }
    from = segment.to;
  }
  return distances;
}

function cubicPoint(from: Vec2, segment: CubicPathSegment, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * from.x + b * segment.control1.x + c * segment.control2.x + d * segment.to.x,
    y: a * from.y + b * segment.control1.y + c * segment.control2.y + d * segment.to.y,
  };
}
