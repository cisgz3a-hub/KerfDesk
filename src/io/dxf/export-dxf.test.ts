import { describe, expect, it } from 'vitest';
import {
  createProject,
  flattenCurveSubpath,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type ImportedSvg,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { transformCurveSubpathExact } from '../../core/vector-export/affine-curves';
import { svgObjectMatrix } from '../svg/export-svg-paths';
import { exportSceneDxf, tracedLayersToDxf } from './export-dxf';
import { parseDxf } from './parse-dxf';

const CURVE_TOLERANCE_MM = 0.01;
const PRECISION_MM = 0.001;
// Flattening bound plus half a grid diagonal of rounding.
const ROUND_TRIP_BOUND_MM = CURVE_TOLERANCE_MM + PRECISION_MM;

const circle = (cx: number, cy: number, r: number): CurveSubpath => ({
  start: { x: cx + r, y: cy },
  closed: true,
  segments: [
    { x: cx, y: cy + r },
    { x: cx - r, y: cy },
    { x: cx, y: cy - r },
    { x: cx + r, y: cy },
  ].map((to) => ({
    kind: 'elliptical-arc' as const,
    radiusX: r,
    radiusY: r,
    rotationDeg: 0,
    largeArc: false,
    sweep: true,
    to,
  })),
});

const artwork: ImportedSvg = {
  kind: 'imported-svg',
  id: 'art',
  source: 'art.svg',
  bounds: { minX: 0, minY: 0, maxX: 40, maxY: 30 },
  transform: { ...IDENTITY_TRANSFORM, x: 12.5, y: -3, scaleX: 1.5, rotationDeg: 30, mirrorY: true },
  paths: [
    {
      color: '#ff0000',
      polylines: [],
      curves: [
        {
          start: { x: 0, y: 0 },
          closed: true,
          segments: [
            { kind: 'line', to: { x: 20, y: 0 } },
            {
              kind: 'cubic',
              control1: { x: 30, y: 0 },
              control2: { x: 30, y: 20 },
              to: { x: 20, y: 20 },
            },
            { kind: 'line', to: { x: 0, y: 20 } },
            { kind: 'line', to: { x: 0, y: 0 } },
          ],
        },
        circle(8, 10, 4),
      ],
    },
    {
      color: '#1a2b3c',
      polylines: [],
      curves: [
        {
          start: { x: 35, y: 5 },
          closed: false,
          segments: [
            {
              kind: 'elliptical-arc',
              radiusX: 6,
              radiusY: 3,
              rotationDeg: 20,
              largeArc: true,
              sweep: false,
              to: { x: 35, y: 15 },
            },
          ],
        },
      ],
    },
  ],
};

function project(objects: readonly SceneObject[]): Project {
  const base = createProject();
  return { ...base, scene: { ...base.scene, objects } };
}

function exportedDxf(objects: readonly SceneObject[]): string {
  const result = exportSceneDxf(project(objects));
  if (result.kind !== 'ok') throw new Error(result.error);
  return result.value.dxf;
}

function densePoints(curves: ReadonlyArray<CurveSubpath>): Vec2[][] {
  return curves.map((curve) => {
    const flat = flattenCurveSubpath(curve, { toleranceMm: 1e-5 });
    if (flat.kind !== 'ok') throw new Error('flatten failed');
    const points = [...flat.polyline.points];
    if (curve.closed) points.push(points[0] as Vec2);
    return points;
  });
}

function distanceToPolylines(p: Vec2, polylines: ReadonlyArray<ReadonlyArray<Vec2>>): number {
  let best = Infinity;
  for (const line of polylines) {
    for (let i = 1; i < line.length; i += 1) {
      const a = line[i - 1] as Vec2;
      const b = line[i] as Vec2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSq = dx * dx + dy * dy;
      const t =
        lengthSq === 0
          ? 0
          : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
      best = Math.min(best, Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y));
    }
  }
  return best;
}

function hausdorff(
  a: ReadonlyArray<ReadonlyArray<Vec2>>,
  b: ReadonlyArray<ReadonlyArray<Vec2>>,
): number {
  let worst = 0;
  for (const line of a) for (const p of line) worst = Math.max(worst, distanceToPolylines(p, b));
  for (const line of b) for (const p of line) worst = Math.max(worst, distanceToPolylines(p, a));
  return worst;
}

function worldCurves(object: ImportedSvg, color: string): CurveSubpath[] {
  const matrix = svgObjectMatrix(object.transform);
  return (object.paths.find((path) => path.color === color)?.curves ?? []).map((curve) =>
    transformCurveSubpathExact(curve, matrix),
  );
}

function translate(curves: ReadonlyArray<ReadonlyArray<Vec2>>, dx: number, dy: number): Vec2[][] {
  return curves.map((line) => line.map((p) => ({ x: p.x + dx, y: p.y + dy })));
}

describe('artwork DXF export', () => {
  it('round-trips through the DXF importer within the stated tolerance, per colour', () => {
    const dxf = exportedDxf([artwork]);
    const imported = parseDxf({ dxfText: dxf, id: 'back', source: 'back.dxf' });
    if (imported.kind !== 'ok' || imported.object === null) throw new Error('import failed');
    expect(imported.notes).toEqual([]);
    expect(imported.skippedSummary).toBeNull();
    const colors = imported.object.paths.map((path) => path.color).sort();
    expect(colors).toEqual(['#1a2b3c', '#ff0000']);
    // The importer places the drawing's lower-left corner at the origin; the
    // writer put the artwork's top-left there, so the two frames differ only
    // by the artwork's minimum corner.
    const all = densePoints([
      ...worldCurves(artwork, '#ff0000'),
      ...worldCurves(artwork, '#1a2b3c'),
    ]);
    const minX = Math.min(...all.flat().map((p) => p.x));
    const minY = Math.min(...all.flat().map((p) => p.y));
    for (const color of colors) {
      const back = imported.object.paths.find((path) => path.color === color);
      const expected = translate(densePoints(worldCurves(artwork, color)), -minX, -minY);
      const actual = densePoints(back?.curves ?? []);
      expect(back?.curves?.map((curve) => curve.closed)).toEqual(
        worldCurves(artwork, color).map((curve) => curve.closed),
      );
      expect(hausdorff(expected, actual)).toBeLessThanOrEqual(ROUND_TRIP_BOUND_MM);
    }
  });

  it('writes circular arcs as exact bulges on one polyline', () => {
    const plain: ImportedSvg = { ...artwork, transform: IDENTITY_TRANSFORM };
    const dxf = exportedDxf([
      { ...plain, paths: [{ color: '#000000', polylines: [], curves: [circle(10, 10, 5)] }] },
    ]);
    const lines = dxf.split('\n').map((line) => line.trim());
    const entities = lines.indexOf('ENTITIES');
    const bulges = lines.flatMap((line, i) =>
      i > entities && i % 2 === 0 && line === '42' ? [Number(lines[i + 1])] : [],
    );
    // Four quarter circles; SVG sweep=1 is clockwise once Y points up.
    expect(bulges).toHaveLength(4);
    for (const bulge of bulges) expect(bulge).toBeCloseTo(-Math.tan(Math.PI / 8), 14);
    const imported = parseDxf({ dxfText: dxf, id: 'c', source: 'c.dxf' });
    if (imported.kind !== 'ok' || imported.object === null) throw new Error('import failed');
    const curve = imported.object.paths[0]?.curves?.[0];
    const back = densePoints(curve === undefined ? [] : [curve]);
    // The bulges are exact; what remains is the importer's own quarter-arc
    // cubic (radial error about 2.7e-4 x radius = 0.0014 mm here).
    const expected = densePoints([circle(5, 5, 5)]);
    expect(hausdorff(expected, back)).toBeLessThan(2.7e-4 * 5 * 1.05);
    expect(dxf.split('\n').filter((line) => line.trim() === 'LWPOLYLINE')).toHaveLength(1);
    expect(lines.filter((line, i) => i > entities && i % 2 === 0 && line === '10')).toHaveLength(4);
  });

  it('declares millimetres, AC1018 and unique handles below the handle seed', () => {
    const dxf = exportedDxf([artwork]);
    const lines = dxf.split('\n').map((line) => line.trim());
    const value = (name: string): string | undefined => lines[lines.indexOf(name) + 2];
    expect(value('$ACADVER')).toBe('AC1018');
    expect(value('$INSUNITS')).toBe('4');
    const handles = lines.flatMap((line, i) =>
      (line === '5' || line === '105') && i % 2 === 0 && lines[i - 1] !== '$HANDSEED'
        ? [Number.parseInt(lines[i + 1] ?? '', 16)]
        : [],
    );
    expect(new Set(handles).size).toBe(handles.length);
    expect(Math.max(...handles)).toBeLessThan(Number.parseInt(value('$HANDSEED') ?? '0', 16));
    expect(lines.filter((line) => line === 'LWPOLYLINE')).toHaveLength(3);
    expect(lines).toContain('RGB_FF0000');
    expect(lines).toContain('RGB_1A2B3C');
    expect(lines.at(-2)).toBe('EOF');
  });

  it('omits bitmaps with a count and refuses a selection with no vector artwork', () => {
    const image: SceneObject = {
      kind: 'raster-image',
      id: 'photo',
      source: 'photo.png',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      color: '#808080',
      pixelWidth: 1,
      pixelHeight: 1,
      linesPerMm: 1,
      dither: 'grayscale',
    };
    const mixed = exportSceneDxf(project([artwork, image]));
    expect(mixed.kind === 'ok' && mixed.value.omittedObjectCount).toBe(1);
    const onlyImage = exportSceneDxf(project([image]));
    expect(onlyImage.kind).toBe('error');
  });

  it('keeps each traced page registered to the image frame', () => {
    const dxf = tracedLayersToDxf(
      [
        {
          color: '#000000',
          curves: [
            {
              start: { x: 2, y: 3 },
              closed: true,
              segments: [
                { kind: 'line', to: { x: 4, y: 3 } },
                { kind: 'line', to: { x: 4, y: 5 } },
              ],
            },
          ],
        },
      ],
      { pageHeight: 10 },
    );
    const lines = dxf.split('\n').map((line) => line.trim());
    const start = lines.indexOf('AcDbPolyline');
    const coords = lines
      .slice(start)
      .flatMap((line, i, all) =>
        i % 2 === 1 && (line === '10' || line === '20') ? [Number(all[i + 1])] : [],
      );
    // Scene Y 3 on a 10 mm page is DXF Y 7 above the page's lower-left corner.
    expect(coords).toEqual([2, 7, 4, 7, 4, 5]);
  });
});
