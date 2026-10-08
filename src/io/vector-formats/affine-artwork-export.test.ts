import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type Project,
  type Transform,
} from '../../core/scene';
import { validateProjectShape } from '../project/project-shape-validator';
import { exportSceneSvg } from '../svg/export-scene-svg';
import { parseSvg } from '../svg/parse-svg';
import { svgObjectMatrix } from '../svg/export-svg-paths';
import { curvesBounds, transformCurveSubpathExact } from '../../core/vector-export/affine-curves';
import { exportSceneDxf } from '../dxf/export-dxf';
import { parseDxf } from '../dxf/parse-dxf';
import { writePdfDocument } from './pdf-writer';
import { writeEpsDocument } from './eps-writer';
import { writeGeoJsonDocument } from './geojson-writer';
import { artworkExtent, gridCommands, preparePage, sceneVectorArtwork } from './vector-artwork';

const semicircle: CurveSubpath = {
  start: { x: 0, y: 1 },
  closed: false,
  segments: [
    {
      kind: 'elliptical-arc',
      radiusX: 1,
      radiusY: 1,
      rotationDeg: 0,
      largeArc: false,
      sweep: false,
      to: { x: 0, y: -1 },
    },
  ],
};

function project(transform: Transform, curve: CurveSubpath = semicircle): Project {
  const base = createProject();
  return {
    ...base,
    scene: {
      ...base.scene,
      layers: [createLayer({ id: 'line', color: '#000000', mode: 'line' })],
      objects: [
        {
          kind: 'imported-svg',
          id: 'arc',
          source: 'semicircle.svg',
          transform,
          bounds: { minX: 0, maxX: 1, minY: -1, maxY: 1 },
          paths: [{ color: '#000000', polylines: [], curves: [curve] }],
        },
      ],
    },
  };
}

function importedSvgExtent(svg: string): readonly [number, number] {
  const imported = parseSvg({ svgText: svg, id: 'svg-back', source: 'back.svg' }).object;
  if (imported === null) throw new Error('SVG round trip failed');
  const curves = imported.paths.flatMap((path) => path.curves ?? []);
  const b = curvesBounds(
    curves.map((curve) => transformCurveSubpathExact(curve, svgObjectMatrix(imported.transform))),
  );
  if (b === null) throw new Error('Missing imported SVG geometry');
  return [b.maxX - b.minX, b.maxY - b.minY];
}

function viewBox(svg: string): number[] {
  return (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? '').split(' ').map(Number);
}

function polylineFlags(dxf: string): string | undefined {
  return /^\s*70\r?\n([^\r\n]+)/m.exec(dxf.split('LWPOLYLINE')[1] ?? '')?.[1];
}

type DxfVertex = { x: number; y: number; bulge: number };

function writtenDxfVertices(text: string): DxfVertex[] {
  const lines = text.split('LWPOLYLINE')[1]?.trim().split(/\r?\n/) ?? [];
  const vertices: DxfVertex[] = [];
  let point: DxfVertex | undefined;
  // The entity name precedes its first group code in this raw representation.
  for (let index = 0; index < lines.length; index += 2) {
    const code = Number(lines[index]);
    const value = Number(lines[index + 1]);
    if (code === 0) break;
    if (code === 10) {
      point = { x: value, y: 0, bulge: 0 };
      vertices.push(point);
    }
    if (code === 20 && point !== undefined) point.y = value;
    if (code === 42 && point !== undefined) point.bulge = value;
  }
  return vertices;
}

// Independent DXF circle reconstruction and angle-domain extrema, without
// reusing the scene importer, endpoint-arc decoder or export fitting helper.
function writtenEdgeMaxX(from: DxfVertex, to: DxfVertex): number {
  const bulge = from.bulge;
  if (bulge === 0) return Math.max(from.x, to.x);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const offset = (1 - bulge * bulge) / (4 * bulge);
  const center = { x: (from.x + to.x) / 2 - dy * offset, y: (from.y + to.y) / 2 + dx * offset };
  const radius = (Math.hypot(dx, dy) * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
  const start = Math.atan2(from.y - center.y, from.x - center.x);
  const delta = 4 * Math.atan(bulge);
  const tau = 2 * Math.PI;
  const turn = (((-start * Math.sign(delta)) % tau) + tau) % tau;
  return turn <= Math.abs(delta) ? center.x + radius : Math.max(from.x, to.x);
}

function writtenDxfMaxX(text: string): number {
  const vertices = writtenDxfVertices(text);
  return Math.max(...vertices.slice(1).map((to, index) => writtenEdgeMaxX(vertices[index]!, to)));
}

function assertSvgExcursion(
  scene: Project,
  scaleY: number,
  width: number,
  height: number,
  precisionMm: number | null,
): void {
  const svg = exportSceneSvg(scene, undefined, { precisionMm });
  if (svg.kind !== 'ok') throw new Error(svg.error);
  const [, , w, h] = viewBox(svg.value.svg);
  const [backWidth, backHeight] = importedSvgExtent(svg.value.svg);
  if (scaleY === 0 && precisionMm !== null) {
    // This fixture's origin is exactly on the world grid. The rank-one peak
    // snaps once; compare actual page/path dimensions with that independent
    // rounded peak, then check its displacement against the original bound.
    const writtenWidth = Math.round(width / precisionMm) * precisionMm;
    const writtenHeight = Math.round(height / precisionMm) * precisionMm;
    expect(w).toBeCloseTo(Math.max(0.01, writtenWidth), 10);
    expect(h).toBeCloseTo(Math.max(0.01, writtenHeight), 10);
    expect(backWidth).toBeCloseTo(writtenWidth, 8);
    expect(backHeight).toBeCloseTo(writtenHeight, 8);
    expect(Math.hypot(writtenWidth - width, writtenHeight - height)).toBeLessThanOrEqual(
      (precisionMm * Math.SQRT2) / 2,
    );
  } else {
    expect(w).toBeGreaterThanOrEqual(width - 1e-9);
    expect(h).toBeGreaterThanOrEqual(height - 1e-9);
  }
  if (scaleY > Number.EPSILON) expect(svg.value.svg).toMatch(/d="M0 1\s*A1 1 0 0 0 0\s*-1"/);
  expect(svg.value.svg).not.toMatch(/NaN|Infinity/);
  expect(backWidth).toBeGreaterThanOrEqual(width - 0.001);
  expect(backHeight).toBeGreaterThanOrEqual(height - 0.001);
}

describe('admitted singular and eccentric artwork exports', () => {
  for (const scaleY of [1e-7, 1e-12, 1e-16, 1e-17, 0]) {
    for (const rotationDeg of [0, 17, 90]) {
      for (const mirrorX of [false, true]) {
        it(`exports the complete excursion for scaleY=${scaleY}, rotation=${rotationDeg}, mirror=${mirrorX}`, () => {
          const scene = project({
            ...IDENTITY_TRANSFORM,
            scaleY,
            rotationDeg,
            mirrorX,
            x: 123_456,
            y: -234_567,
          });
          expect(
            validateProjectShape(JSON.parse(JSON.stringify(scene)) as Record<string, unknown>),
          ).toBeNull();
          const snapshot = JSON.stringify(scene);
          const theta = (rotationDeg * Math.PI) / 180;
          const width = Math.abs(Math.cos(theta));
          const height = Math.abs(Math.sin(theta));
          for (const precisionMm of [0.001, null]) {
            assertSvgExcursion(scene, scaleY, width, height, precisionMm);
          }
          const dxf = exportSceneDxf(scene);
          if (dxf.kind !== 'ok') throw new Error(dxf.error);
          expect(dxf.value.polylineCount).toBe(1);
          expect(dxf.value.dxf).not.toMatch(/NaN|Infinity/);
          const back = parseDxf({ dxfText: dxf.value.dxf, id: 'back', source: 'back.dxf' });
          if (back.kind !== 'ok' || back.object === null) throw new Error('DXF round trip failed');
          expect(back.object.bounds.maxX - back.object.bounds.minX).toBeGreaterThanOrEqual(
            width - 0.001,
          );
          expect(back.object.bounds.maxY - back.object.bounds.minY).toBeGreaterThanOrEqual(
            height - 0.001,
          );
          // The importer recognises coincident endpoints as geometric closure;
          // the actual DXF retains the authored open flag and both line edges.
          expect(polylineFlags(dxf.value.dxf)).toBe('0');
          const artwork = sceneVectorArtwork(scene);
          if (artwork.kind !== 'ok') throw new Error(artwork.error);
          const extent = artworkExtent(artwork.value.items);
          if (extent === null) throw new Error('Missing artwork extent');
          expect(extent.maxX - extent.minX).toBeGreaterThanOrEqual(width - 1e-9);
          expect(extent.maxY - extent.minY).toBeGreaterThanOrEqual(height - 1e-9);
          const pdf = writePdfDocument(artwork.value.items);
          const eps = writeEpsDocument(artwork.value.items);
          expect(pdf.text).not.toMatch(/NaN|Infinity/);
          expect(eps.text).not.toMatch(/NaN|Infinity/);
          expect(pdf.pathCount).toBe(1);
          expect(eps.pathCount).toBe(1);
          const geo = writeGeoJsonDocument(artwork.value.items);
          const json = JSON.parse(geo.text) as { bbox: [number, number, number, number] };
          expect(json.bbox[2] - json.bbox[0]).toBeGreaterThanOrEqual(width - 0.001);
          expect(json.bbox[3] - json.bbox[1]).toBeGreaterThanOrEqual(height - 0.001);
          expect(geo.lineCount).toBe(1);
          expect(JSON.stringify(scene)).toBe(snapshot);
        });
      }
    }
  }

  it.each([1e-16, 0])(
    'writes the actual out-and-back path in every non-SVG format at scaleY=%s',
    (scaleY) => {
      const scene = project({ ...IDENTITY_TRANSFORM, scaleY });
      const artwork = sceneVectorArtwork(scene);
      if (artwork.kind !== 'ok') throw new Error(artwork.error);
      const page = preparePage(artwork.value.items, {});
      expect(page.widthSteps).toBe(1_000);
      const curve = artwork.value.items[0]?.curves[0];
      if (curve === undefined) throw new Error('Missing artwork curve');
      const commands = gridCommands(curve, page);
      expect(commands.some((c) => c.op !== 'close' && c.p.x === 1_000)).toBe(true);
      expect(commands.at(-1)).toMatchObject({ p: { x: 0 } });
      const pdf = writePdfDocument(artwork.value.items).text;
      const eps = writeEpsDocument(artwork.value.items).text;
      expect(pdf).toMatch(/1 0 (?:l|c)\n/);
      expect(eps).toMatch(/1 0 (?:l|c)/);
      const geo = JSON.parse(writeGeoJsonDocument(artwork.value.items).text) as {
        features: { geometry: { type: string; coordinates: number[][] } }[];
      };
      expect(geo.features[0]?.geometry).toMatchObject({
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 0],
          [0, 0],
        ],
      });
      const dxf = exportSceneDxf(scene, undefined, { curveToleranceMm: 1e-6, precisionMm: 1e-6 });
      if (dxf.kind !== 'ok') throw new Error(dxf.error);
      const back = parseDxf({ dxfText: dxf.value.dxf, id: 'back', source: 'back.dxf' });
      if (back.kind !== 'ok' || back.object === null) throw new Error('DXF round trip failed');
      expect(back.object.paths[0]?.curves?.[0]).toMatchObject({
        start: { x: 0, y: 0 },
        segments: [
          { kind: 'line', to: { x: 1, y: 0 } },
          { kind: 'line', to: { x: 0, y: 0 } },
        ],
      });
      expect(polylineFlags(dxf.value.dxf)).toBe('0');
    },
  );

  it('keeps genuinely point-sized output distinct from a projected arc excursion', () => {
    const scene = project({ ...IDENTITY_TRANSFORM, scaleX: 0, scaleY: 0 });
    const svg = exportSceneSvg(scene);
    if (svg.kind !== 'ok') throw new Error(svg.error);
    expect(viewBox(svg.value.svg)).toEqual([0, 0, 0.01, 0.01]);
    expect(exportSceneDxf(scene)).toEqual({
      kind: 'error',
      error: 'There is no vector geometry to write.',
    });
  });

  it('ignores an admitted persisted artworkArc JSON key in every artwork format', () => {
    const spoof = {
      center: { x: 1000, y: 1000 },
      u: { x: 900, y: 0 },
      v: { x: 0, y: 900 },
      theta1: 0,
      delta: Math.PI,
    };
    const forged = {
      ...semicircle,
      segments: semicircle.segments.map((s) => ({ ...s, artworkArc: spoof })),
    };
    const clean = project(IDENTITY_TRANSFORM);
    const saved = JSON.parse(JSON.stringify(project(IDENTITY_TRANSFORM, forged))) as Project;
    expect(validateProjectShape(saved as unknown as Record<string, unknown>)).toBeNull();
    expect(exportSceneSvg(saved)).toEqual(exportSceneSvg(clean));
    expect(exportSceneDxf(saved)).toEqual(exportSceneDxf(clean));
    const a = sceneVectorArtwork(saved);
    const b = sceneVectorArtwork(clean);
    if (a.kind !== 'ok' || b.kind !== 'ok') throw new Error('Missing artwork');
    expect(writePdfDocument(a.value.items)).toEqual(writePdfDocument(b.value.items));
    expect(writeEpsDocument(a.value.items)).toEqual(writeEpsDocument(b.value.items));
    expect(writeGeoJsonDocument(a.value.items)).toEqual(writeGeoJsonDocument(b.value.items));
  });

  it('snaps singular SVG once in world space, within the original half-grid-diagonal bound', () => {
    const line: CurveSubpath = {
      start: { x: 0.51, y: 0 },
      closed: false,
      segments: [{ kind: 'line', to: { x: 1.51, y: 0 } }],
    };
    const scene = project({ ...IDENTITY_TRANSFORM, scaleY: 0, rotationDeg: 45 }, line);
    const svg = exportSceneSvg(scene, undefined, { precisionMm: 1 });
    if (svg.kind !== 'ok') throw new Error(svg.error);
    const d = /<path d="([^"]+)"/.exec(svg.value.svg)?.[1];
    expect(d).toBe('M0 0l1 1');
    const authored = 0.51 * Math.SQRT1_2;
    expect(Math.hypot(authored, authored)).toBeLessThanOrEqual(Math.SQRT2 / 2);
    const authoredEnd = 1.51 * Math.SQRT1_2;
    expect(Math.hypot(1 - authoredEnd, 1 - authoredEnd)).toBeLessThanOrEqual(Math.SQRT2 / 2);
    expect(svg.value.svg).toContain('matrix(1 0 0 1 0 0)');
  });

  it.each([
    [1, 1e-6],
    [1_000, 0.01],
    [100_000, 0.01],
  ])(
    'bounds the actual near-circle DXF locus at radius=%s and tolerance=%s',
    (radius, tolerance) => {
      const scene = project({
        ...IDENTITY_TRANSFORM,
        scaleX: radius,
        scaleY: radius * (1 - 9e-10),
      });
      expect(
        validateProjectShape(JSON.parse(JSON.stringify(scene)) as Record<string, unknown>),
      ).toBeNull();
      const dxf = exportSceneDxf(scene, undefined, {
        curveToleranceMm: tolerance,
        precisionMm: 1e-6,
      });
      if (dxf.kind !== 'ok') throw new Error(dxf.error);
      expect(Math.abs(writtenDxfMaxX(dxf.value.dxf) - radius)).toBeLessThanOrEqual(
        tolerance + (1e-6 * Math.SQRT2) / 2,
      );
    },
  );

  it('retains a nearly full circular traversal when translation collapses its mapped endpoints', () => {
    const curve: CurveSubpath = {
      ...semicircle,
      segments: [
        {
          ...semicircle.segments[0]!,
          kind: 'elliptical-arc',
          radiusX: 1,
          radiusY: 1,
          rotationDeg: 0,
          largeArc: true,
          sweep: false,
          to: { x: 1e-17, y: 1 },
        },
      ],
    };
    const scene = project({ ...IDENTITY_TRANSFORM, x: 1_000, y: 1_000 }, curve);
    expect(
      validateProjectShape(JSON.parse(JSON.stringify(scene)) as Record<string, unknown>),
    ).toBeNull();
    const dxf = exportSceneDxf(scene, undefined, { curveToleranceMm: 1e-6, precisionMm: 1e-6 });
    if (dxf.kind !== 'ok') throw new Error(dxf.error);
    // DXF's existing drawing origin is the exact artwork minimum (x=999).
    expect(writtenDxfMaxX(dxf.value.dxf)).toBeCloseTo(2, 6);
    expect(polylineFlags(dxf.value.dxf)).toBe('0');
    expect(writtenDxfVertices(dxf.value.dxf).length).toBeGreaterThan(2);
  });

  it('retains the full DXF circle for the admitted near-full-turn translated control', () => {
    const curve: CurveSubpath = {
      start: { x: 1, y: 0 },
      closed: false,
      segments: [
        {
          kind: 'elliptical-arc',
          radiusX: 1,
          radiusY: 1,
          rotationDeg: 0,
          largeArc: true,
          sweep: false,
          to: { x: 1, y: 1e-12 },
        },
      ],
    };
    const scene = project({ ...IDENTITY_TRANSFORM, x: 100_000, y: -200_000 }, curve);
    expect(
      validateProjectShape(JSON.parse(JSON.stringify(scene)) as Record<string, unknown>),
    ).toBeNull();
    const dxf = exportSceneDxf(scene);
    if (dxf.kind !== 'ok') throw new Error(dxf.error);
    expect(Math.abs(writtenDxfMaxX(dxf.value.dxf) - 2)).toBeLessThanOrEqual(
      0.01 + (0.001 * Math.SQRT2) / 2,
    );
    expect(polylineFlags(dxf.value.dxf)).toBe('0');
    expect(writtenDxfVertices(dxf.value.dxf).length).toBeGreaterThan(2);
  });
});
