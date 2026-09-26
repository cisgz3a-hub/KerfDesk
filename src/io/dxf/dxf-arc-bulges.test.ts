// The DXF writer's circular-arc bulges (ADR-452), read back from the written
// text: group 42 values, exact sampling of what they draw, the importer's
// round trip, and byte identity for straight-line input.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { flattenCurveSubpath, type CurveSubpath, type Vec2 } from '../../core/scene';
import type { BulgeVertex } from '../../core/vector-export/bulge-rings';
import { hausdorff, sampleBulges } from '../../core/vector-export/bulge-sampling.test-support';
import { writeDxfDocument } from './dxf-writer';
import { parseDxf } from './parse-dxf';

const TOLERANCE_MM = 0.01;
const KAPPA = 0.5522847498307936;

type WrittenPolyline = { readonly vertices: BulgeVertex[]; readonly closed: boolean };

/** LWPOLYLINEs of the written text, back in the scene's Y-down frame. */
function writtenPolylines(text: string): WrittenPolyline[] {
  const lines = text.split('\n').map((line) => line.trim());
  const out: WrittenPolyline[] = [];
  let current: WrittenPolyline | null = null;
  for (let i = lines.indexOf('ENTITIES'); i + 1 < lines.length; i += 2) {
    const code = lines[i - 1] ?? '';
    const value = lines[i] ?? '';
    if (code === '0') {
      current = value === 'LWPOLYLINE' ? { vertices: [], closed: false } : null;
      if (current !== null) out.push(current);
    } else if (current !== null) {
      applyVertexTag(current, code, value);
    }
  }
  return out;
}

function applyVertexTag(polyline: WrittenPolyline, code: string, value: string): void {
  if (code === '70') (polyline as { closed: boolean }).closed = value === '1';
  if (code === '10') polyline.vertices.push({ x: Number(value), y: 0, bulge: 0 });
  const last = polyline.vertices[polyline.vertices.length - 1];
  if (last === undefined) return;
  if (code === '20') (last as { y: number }).y = -Number(value);
  if (code === '42') {
    expect(value).toMatch(/^-?\d+(\.\d+)?$/);
    (last as { bulge: number }).bulge = Number(value);
  }
}

function flat(curve: CurveSubpath): Vec2[] {
  const result = flattenCurveSubpath(curve, { toleranceMm: 1e-5 });
  if (result.kind !== 'ok') throw new Error('flatten failed');
  return [...result.polyline.points];
}

function cubicCircle(r: number, clockwiseOnScreen: boolean): CurveSubpath {
  const k = r * KAPPA;
  const s = clockwiseOnScreen ? 1 : -1;
  return {
    start: { x: r, y: 0 },
    closed: true,
    segments: [
      {
        kind: 'cubic',
        control1: { x: r, y: s * k },
        control2: { x: k, y: s * r },
        to: { x: 0, y: s * r },
      },
      {
        kind: 'cubic',
        control1: { x: -k, y: s * r },
        control2: { x: -r, y: s * k },
        to: { x: -r, y: 0 },
      },
      {
        kind: 'cubic',
        control1: { x: -r, y: -s * k },
        control2: { x: -k, y: -s * r },
        to: { x: 0, y: -s * r },
      },
      {
        kind: 'cubic',
        control1: { x: k, y: -s * r },
        control2: { x: r, y: -s * k },
        to: { x: r, y: 0 },
      },
    ],
  };
}

const sCurve: CurveSubpath = {
  start: { x: 0, y: 0 },
  closed: false,
  segments: [
    {
      kind: 'cubic',
      control1: { x: 30, y: -25 },
      control2: { x: -10, y: 45 },
      to: { x: 25, y: 20 },
    },
  ],
};

const ellipse: CurveSubpath = {
  start: { x: 30, y: 0 },
  closed: true,
  segments: [
    {
      kind: 'elliptical-arc',
      radiusX: 15,
      radiusY: 6,
      rotationDeg: 0,
      largeArc: true,
      sweep: true,
      to: { x: 0, y: 0 },
    },
    {
      kind: 'elliptical-arc',
      radiusX: 15,
      radiusY: 6,
      rotationDeg: 0,
      largeArc: true,
      sweep: true,
      to: { x: 30, y: 0 },
    },
  ],
};

describe('DXF writer arc bulges (ADR-452)', () => {
  it.each([
    ['clockwise circle', cubicCircle(12, true), -1],
    ['counter-clockwise circle', cubicCircle(12, false), 1],
  ] as const)('writes valid, correctly signed group 42 bulges for a %s', (_name, curve, sign) => {
    const doc = writeDxfDocument([{ color: '#000000', curves: [curve] }], {
      origin: { x: 0, y: 0 },
    });
    const [polyline] = writtenPolylines(doc.text);
    if (polyline === undefined) throw new Error('no polyline');
    const bulges = polyline.vertices.map((v) => v.bulge).filter((b) => b !== 0);
    expect(bulges.length).toBeGreaterThanOrEqual(2);
    for (const bulge of bulges) {
      expect(Math.sign(bulge)).toBe(sign);
      expect(Math.abs(bulge)).toBeLessThan(1);
    }
    expect(polyline.closed).toBe(true);
    const drawn = sampleBulges(polyline.vertices, true);
    // Written coordinates are on the 0.001 mm grid; the fitter reserves room for it.
    expect(hausdorff(flat(curve), drawn)).toBeLessThanOrEqual(TOLERANCE_MM);
  });

  it.each([
    ['S-curve', sCurve],
    ['ellipse', ellipse],
    ['tiny circle', cubicCircle(0.15, true)],
  ] as const)('keeps the written %s within the tolerance', (_name, curve) => {
    const doc = writeDxfDocument([{ color: '#000000', curves: [curve] }], {
      origin: { x: 0, y: 0 },
    });
    const [polyline] = writtenPolylines(doc.text);
    if (polyline === undefined) throw new Error('no polyline');
    expect(
      hausdorff(flat(curve), sampleBulges(polyline.vertices, polyline.closed)),
    ).toBeLessThanOrEqual(TOLERANCE_MM);
  });

  it('round-trips the fitted arcs through the DXF importer', () => {
    const curves = [cubicCircle(12, true), sCurve, ellipse];
    const doc = writeDxfDocument([{ color: '#000000', curves }], { origin: { x: 0, y: 0 } });
    const imported = parseDxf({ dxfText: doc.text, id: 'rt', source: 'rt.dxf' });
    if (imported.kind !== 'ok' || imported.object === null) throw new Error('import failed');
    const back = imported.object.paths.flatMap((path) => path.curves ?? []);
    expect(back.map((curve) => curve.closed)).toEqual([true, false, true]);
    // The importer turns each bulge into cubics (radial error about
    // 2.7e-4 x radius per quarter turn), so the bound adds that for these radii.
    const importerSlack = 2.7e-4 * 15;
    // The importer places the drawing's top-left corner at the scene origin.
    const source = curves.map(flat);
    const minX = Math.min(...source.flat().map((p) => p.x));
    const minY = Math.min(...source.flat().map((p) => p.y));
    back.forEach((curve, index) => {
      const expected = (source[index] as Vec2[]).map((p) => ({ x: p.x - minX, y: p.y - minY }));
      expect(hausdorff(expected, flat(curve))).toBeLessThanOrEqual(TOLERANCE_MM + importerSlack);
    });
  });

  it('writes straight-line input byte for byte as before', () => {
    const doc = writeDxfDocument([
      {
        color: '#336699',
        curves: [
          {
            start: { x: 1.25, y: 2 },
            closed: true,
            segments: [
              { kind: 'line', to: { x: 11.0004, y: 2 } },
              { kind: 'line', to: { x: 11, y: 9.3333333 } },
              { kind: 'line', to: { x: 1.25, y: 9 } },
            ],
          },
          {
            start: { x: -3, y: 0 },
            closed: false,
            segments: [
              { kind: 'line', to: { x: 4, y: -2 } },
              { kind: 'line', to: { x: 4, y: -2 } },
              { kind: 'line', to: { x: 8, y: 5 } },
            ],
          },
        ],
      },
    ]);
    // SHA-256 of the chord writer's output at 952fb13e3, before arc bulges.
    expect(createHash('sha256').update(doc.text).digest('hex')).toBe(
      '3f6f281176c3dbdcc12e4309efcce27e500ab63672089e5498c4427b108a99be',
    );
  });
});
