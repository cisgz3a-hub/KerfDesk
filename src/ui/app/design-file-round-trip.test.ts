// Rolling v7 L7-P1-1 / L7-P2-1 (ADR-681): artwork exported as SVG or DXF and
// imported back burns what it burned before, and keeps one colour per
// operation. Each case goes through the real exporter, parser, store import
// and compiler; the burned area is the hatch length times its spacing.

import { beforeEach, describe, expect, it } from 'vitest';
import { compileJob } from '../../core/job/compile-job';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  operationIdsForObject,
  type ImportedSvg,
  type Layer,
  type Project,
  type SceneObject,
  type ShapeObject,
} from '../../core/scene';
import { createEllipse } from '../../core/shapes/primitives/create-ellipse';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import { exportSceneDxf } from '../../io/dxf/export-dxf';
import { parseDxf } from '../../io/dxf/parse-dxf';
import { exportSceneSvg } from '../../io/svg/export-scene-svg';
import { parseSvg } from '../../io/svg/parse-svg';
import { sceneVectorArtwork } from '../../io/vector-formats/vector-artwork';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { describeImportResult } from './import-toasts';

const BLACK = '#000000';
const BLUE = '#2563eb';
const RING_MM2 = 40 * 30 - Math.PI * 8 * 8;

beforeEach(() => resetStore());

function pathColours(object: SceneObject): string[] {
  return 'paths' in object ? object.paths.map((path) => path.color.toLowerCase()) : [];
}

function plate(id: string, color: string): ShapeObject {
  return createRectangle({
    id,
    color,
    spec: { widthMm: 40, heightMm: 30, cornerRadiusMm: 0 },
    transform: { ...IDENTITY_TRANSFORM, x: 100, y: 100 },
  });
}

function circle(id: string, color: string): ShapeObject {
  return createEllipse({
    id,
    color,
    spec: { widthMm: 16, heightMm: 16 },
    transform: { ...IDENTITY_TRANSFORM, x: 112, y: 107 },
  });
}

function squares(id: string, rects: ReadonlyArray<readonly [number, number, number, number]>) {
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id,
    source: id + '.svg',
    bounds: { minX: 0, minY: 0, maxX: 200, maxY: 200 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['fill'],
    paths: [
      {
        color: BLACK,
        fillRule: 'nonzero',
        polylines: rects.map(([x, y, w, h]) => ({
          closed: true,
          points: [
            { x, y },
            { x: x + w, y },
            { x: x + w, y: y + h },
            { x, y: y + h },
          ],
        })),
      },
    ],
  };
  return object;
}

/** One Fill operation holding every object, path colour = operation colour (a LightBurn sign). */
function oneFillOperation(objects: ReadonlyArray<SceneObject>): Project {
  const base = createProject();
  return {
    ...base,
    scene: {
      ...base.scene,
      layers: [createLayer({ id: 'fill', color: BLACK, mode: 'fill' })],
      objects: objects.map((object) => ({ ...object, operationIds: ['fill'] })),
    },
  };
}

function burnedAreaMm2(project: Project): number {
  let length = 0;
  for (const group of compileJob(project.scene, project.device).groups) {
    if (group.kind !== 'fill') continue;
    for (const segment of group.segments) {
      for (let index = 1; index < segment.polyline.length; index += 1) {
        const a = segment.polyline[index - 1]!;
        const b = segment.polyline[index]!;
        length += Math.hypot(b.x - a.x, b.y - a.y);
      }
    }
  }
  const spacings = new Set(
    project.scene.layers.filter((layer) => layer.mode === 'fill').map((l) => l.hatchSpacingMm),
  );
  expect(spacings.size).toBe(1);
  return length * [...spacings][0]!;
}

function svgOf(project: Project): string {
  const exported = exportSceneSvg(project);
  if (exported.kind !== 'ok') throw new Error(exported.error);
  return exported.value.svg;
}

/** File → Import of an SVG into a new project, as the import action commits it. */
function importSvg(svgText: string): Project {
  const parsed = parseSvg({ svgText, id: 'rt', source: 'rt.svg' });
  if (parsed.fragment === undefined) throw new Error('Missing SVG fragment');
  const objects = parsed.fragment.entries.filter((entry) => entry.kind === 'imported-svg');
  useStore.getState().newProject();
  useStore.getState().importSvgFragment({
    source: parsed.fragment.source,
    bounds: parsed.fragment.bounds,
    objects,
  });
  return useStore.getState().project;
}

/** File → Import of a DXF into a new project, then every operation set to Fill. */
function importDxfAsFill(project: Project): Project {
  const exported = exportSceneDxf(project);
  if (exported.kind !== 'ok') throw new Error(exported.error);
  const parsed = parseDxf({ dxfText: exported.value.dxf, id: 'rt', source: 'rt.dxf' });
  if (parsed.kind !== 'ok' || parsed.object === null) throw new Error('DXF did not import');
  useStore.getState().newProject();
  useStore.getState().importSvgObject(parsed.object);
  for (const layer of useStore.getState().project.scene.layers) {
    useStore.getState().setLayerParam(layer.id, { mode: 'fill' });
  }
  return useStore.getState().project;
}

function fillColours(svg: string): string[] {
  return [...svg.matchAll(/ fill="(#[0-9a-f]{6})"/gi)].map((match) => match[1]!);
}

describe('a Fill operation of several objects keeps its holes through a round trip', () => {
  it('writes a plate and its inner circle as one even-odd path that re-imports as a ring', () => {
    const source = oneFillOperation([plate('plate', BLACK), circle('circle', BLACK)]);
    const before = burnedAreaMm2(source);
    // Hatching at 0.1 mm spacing burns within 1.5 mm² of the analytic ring.
    expect(Math.abs(before - RING_MM2)).toBeLessThan(1.5);

    const svg = svgOf(source);
    expect(svg.match(/<path\b/g)).toHaveLength(1);
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).not.toContain('id="artwork-');
    expect(burnedAreaMm2(importSvg(svg))).toBeCloseTo(before, 0);

    const parsed = parseSvg({ svgText: svg, id: 'rt', source: 'rt.svg' });
    expect(describeImportResult('rt.svg', parsed)[0]?.message).toBe(
      'Imported rt.svg — 1 object, 1 color',
    );
    expect(burnedAreaMm2(importDxfAsFill(source))).toBeCloseTo(before, 0);
  });

  it('keeps a knocked-out shape whose own contours are non-zero glyphs', () => {
    // An "O": opposite-wound contours, already even-odd clean, so exact curves are kept.
    const letter = squares('letter', [
      [110, 105, 10, 10],
      [112, 107, 6, 6],
    ]);
    const reversed = letter.paths[0]!.polylines[1]!;
    const glyph: ImportedSvg = {
      ...letter,
      paths: [
        {
          ...letter.paths[0]!,
          polylines: [
            letter.paths[0]!.polylines[0]!,
            { ...reversed, points: [...reversed.points].reverse() },
          ],
        },
      ],
    };
    const source = oneFillOperation([plate('plate', BLACK), glyph]);
    const before = burnedAreaMm2(source);
    expect(before).toBeCloseTo(1200 - (100 - 36), 0);
    expect(burnedAreaMm2(importSvg(svgOf(source)))).toBeCloseTo(before, 0);
  });

  it('writes the resolved region of an object whose own contours overlap', () => {
    // Two same-wound squares overlapping by half (script letters with Weld off):
    // non-zero, they are one 150 mm² shape knocked out of the plate.
    const overlapping = squares('script', [
      [110, 105, 10, 10],
      [115, 105, 10, 10],
    ]);
    const source = oneFillOperation([plate('plate', BLACK), overlapping]);
    const before = burnedAreaMm2(source);
    expect(before).toBeCloseTo(1200 - 150, 0);
    expect(burnedAreaMm2(importSvg(svgOf(source)))).toBeCloseTo(before, 0);
  });

  it('paints one even-odd item per Fill operation for PDF, AI, EPS and GeoJSON', () => {
    const source = oneFillOperation([plate('plate', BLACK), circle('circle', BLACK)]);
    const artwork = sceneVectorArtwork(source);
    if (artwork.kind !== 'ok') throw new Error(artwork.error);
    expect(artwork.value.objectCount).toBe(2);
    expect(artwork.value.items).toHaveLength(1);
    expect(artwork.value.items[0]).toMatchObject({ paint: 'fill', fillRule: 'evenodd' });
    expect(artwork.value.items[0]?.curves).toHaveLength(2);
  });
});

describe('exports write each path in its operation colour (L7-P2-1)', () => {
  // As drawn: the first shape takes the starting colour, later ones the first
  // operation's colour (draw-tool.ts currentDrawingColor), and each new
  // artwork gets its own operation with the next palette colour.
  function drawn(shapes: ReadonlyArray<ShapeObject>): Project {
    for (const shape of shapes) useStore.getState().drawShape(shape);
    return useStore.getState().project;
  }

  function operationOf(project: Project, id: string): Layer {
    const object = project.scene.objects.find((candidate) => candidate.id === id)!;
    const operationId = operationIdsForObject(object, project.scene.layers)[0];
    return project.scene.layers.find((layer) => layer.id === operationId)!;
  }

  it('keeps three operations as three colours in SVG, DXF and the painted formats', () => {
    const project = drawn([plate('a', BLACK), circle('b', BLUE), { ...plate('c', BLUE) }]);
    const colours = ['a', 'b', 'c'].map((id) => operationOf(project, id).color);
    expect(new Set(colours).size).toBe(3);
    const svg = svgOf(project);
    expect([...svg.matchAll(/ stroke="(#[0-9a-f]{6})"/gi)].map((m) => m[1])).toEqual(colours);
    const dxf = exportSceneDxf(project);
    if (dxf.kind !== 'ok') throw new Error(dxf.error);
    for (const colour of colours) {
      expect(dxf.value.dxf).toContain('RGB_' + colour.slice(1).toUpperCase());
    }
    const painted = sceneVectorArtwork(project);
    if (painted.kind !== 'ok') throw new Error(painted.error);
    expect(painted.value.items.map((item) => item.color)).toEqual(colours);
    const reimported = importSvg(svg);
    expect(new Set(reimported.scene.objects.flatMap(pathColours))).toEqual(new Set(colours));
  });

  it('follows Assign selection to operation, and the drawn plate keeps its hole', () => {
    drawn([plate('a', BLACK), circle('b', BLUE)]);
    const plateOperation = operationOf(useStore.getState().project, 'a');
    useStore.setState({ selectedObjectId: 'b', additionalSelectedIds: new Set() });
    useStore.getState().assignSelectionToLayer(plateOperation.id);
    useStore.getState().setLayerParam(plateOperation.id, { mode: 'fill' });
    const source = useStore.getState().project;
    expect(operationOf(source, 'b').id).toBe(plateOperation.id);
    const before = burnedAreaMm2(source);
    // Hatching at 0.1 mm spacing burns within 1.5 mm² of the analytic ring.
    expect(Math.abs(before - RING_MM2)).toBeLessThan(1.5);

    const svg = svgOf(source);
    expect(new Set(fillColours(svg))).toEqual(new Set([plateOperation.color]));
    expect(burnedAreaMm2(importSvg(svg))).toBeCloseTo(before, 0);
    expect(burnedAreaMm2(importDxfAsFill(source))).toBeCloseTo(before, 0);
  });
});
