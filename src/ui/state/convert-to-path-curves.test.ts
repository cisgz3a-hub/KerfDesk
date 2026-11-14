// Tools audit T1, T26-P2-1: Convert to Path keeps curves as curves, with the
// object's placement baked into their control points, and burns the same
// outline it burned before (within the machine curve tolerance).
import { beforeEach, describe, expect, it } from 'vitest';
import { compilationPolylines } from '../../core/job/compilation-polylines';
import {
  applyTransform,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type CurveSubpath,
  type ImportedSvg,
  type Layer,
  type Polyline,
  type Project,
  type SceneObject,
  type TextObject,
  type Transform,
  type Vec2,
} from '../../core/scene';
import { createEllipse } from '../../core/shapes/primitives/create-ellipse';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import { emitPreparedGcode } from '../../io/gcode/emit-gcode';
import { prepareOutput } from '../../io/gcode/prepare-output';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

const st = () => useStore.getState();
// Each side is its own flattening to 0.025 mm of the true curve.
const BURN_MATCH_MM = 0.05;

const art = (): Layer => createLayer({ id: 'art', color: '#000000', mode: 'line' });

function load(objects: SceneObject[]): void {
  const base = createProject();
  const project: Project = {
    ...base,
    scene: { ...base.scene, objects, layers: [art()], groups: [] },
  };
  useStore.setState({
    project,
    selectedObjectId: objects[0]?.id ?? null,
    additionalSelectedIds: new Set(objects.slice(1).map((object) => object.id)),
    undoStack: [],
    redoStack: [],
  });
}

const placed: Transform = {
  x: 40,
  y: 25,
  scaleX: 1.7,
  scaleY: 0.6,
  rotationDeg: 33,
  mirrorX: true,
  mirrorY: false,
};

function circle(id: string, transform: Transform = placed): SceneObject {
  return {
    ...createEllipse({ id, color: '#000000', spec: { widthMm: 30, heightMm: 30 }, transform }),
    operationIds: ['art'],
  };
}

function roundedRectangle(id: string): SceneObject {
  return {
    ...createRectangle({
      id,
      color: '#000000',
      spec: { widthMm: 40, heightMm: 20, cornerRadiusMm: 5 },
      transform: { ...placed, mirrorX: false, rotationDeg: -71, scaleX: 0.8, scaleY: 2.4 },
    }),
    operationIds: ['art'],
  };
}

// A glyph-like bowl: two cubics and an arc, as text and curved SVG store them.
const bowl: CurveSubpath = {
  start: { x: 0, y: 0 },
  segments: [
    { kind: 'cubic', control1: { x: 2, y: -6 }, control2: { x: 9, y: -6 }, to: { x: 10, y: 0 } },
    {
      kind: 'elliptical-arc',
      radiusX: 6,
      radiusY: 3,
      rotationDeg: 20,
      largeArc: false,
      sweep: true,
      to: { x: 4, y: 7 },
    },
    { kind: 'cubic', control1: { x: 2, y: 7 }, control2: { x: -1, y: 4 }, to: { x: 0, y: 0 } },
  ],
  closed: true,
};

function curvedPath(): ColoredPath {
  return { color: '#000000', polylines: [{ closed: true, points: [] }], curves: [bowl] };
}

function curvedSvg(id: string): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: 'bowl.svg',
    bounds: { minX: -1, minY: -6, maxX: 10, maxY: 7 },
    transform: { ...placed, scaleX: 3.1, scaleY: 1.2, rotationDeg: 128, mirrorY: true },
    operationIds: ['art'],
    paths: [curvedPath()],
  };
}

function curvedText(id: string): TextObject {
  return {
    kind: 'text',
    id,
    content: 'o',
    fontKey: 'roboto-regular',
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1.4,
    letterSpacing: 0,
    color: '#000000',
    bounds: { minX: -1, minY: -6, maxX: 10, maxY: 7 },
    transform: { ...placed, scaleX: 2, scaleY: 2, rotationDeg: 10, mirrorX: false },
    operationIds: ['art'],
    paths: [curvedPath()],
  } as unknown as TextObject;
}

/** What the laser follows: every path flattened as output compiles it, in world mm. */
function burned(object: SceneObject): ReadonlyArray<Polyline> {
  if (!('paths' in object)) return [];
  return object.paths.flatMap((path) =>
    compilationPolylines(path, object.transform).map((polyline) => ({
      closed: polyline.closed,
      points: polyline.points.map((point) => applyTransform(point, object.transform)),
    })),
  );
}

function distanceToPolyline(point: Vec2, polyline: Polyline): number {
  let best = Infinity;
  const points = polyline.points;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1] as Vec2;
    const b = points[index] as Vec2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t =
      lengthSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
    best = Math.min(best, Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)));
  }
  return best;
}

/** The symmetric Hausdorff distance between two burns, contour by contour. */
function burnDifference(a: ReadonlyArray<Polyline>, b: ReadonlyArray<Polyline>): number {
  expect(b).toHaveLength(a.length);
  let worst = 0;
  a.forEach((polyline, index) => {
    const other = b[index] as Polyline;
    for (const point of polyline.points) worst = Math.max(worst, distanceToPolyline(point, other));
    for (const point of other.points) worst = Math.max(worst, distanceToPolyline(point, polyline));
  });
  return worst;
}

function arcMoves(project: Project): number {
  const prepared = prepareOutput(project);
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) return 0;
  return emitPreparedGcode(prepared)
    .gcode.split('\n')
    .filter((line) => /^G[23]\b/.test(line)).length;
}

function convertedById(id: string): ImportedSvg {
  const object = st().project.scene.objects.find((candidate) => candidate.id === id);
  expect(object?.kind).toBe('imported-svg');
  return object as ImportedSvg;
}

function segmentCount(object: ImportedSvg): number {
  return object.paths.reduce(
    (sum, path) =>
      sum + (path.curves ?? []).reduce((count, curve) => count + curve.segments.length, 0),
    0,
  );
}

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

describe('Convert to Path keeps curves (T26-P2-1)', () => {
  it.each([
    ['a placed circle', () => circle('C')],
    ['a rotated rounded rectangle', () => roundedRectangle('C')],
    ['curved imported SVG', () => curvedSvg('C')],
    ['text', () => curvedText('C')],
  ])('keeps %s as a few curve segments that burn the same outline', (_name, make) => {
    const source = make();
    load([source]);

    st().convertSelectionToPath();

    const converted = convertedById('C');
    expect(converted.transform).toEqual(IDENTITY_TRANSFORM);
    expect(converted.paths.every((path) => path.curves !== undefined)).toBe(true);
    expect(segmentCount(converted)).toBeLessThanOrEqual(16);
    expect(
      converted.paths[0]?.curves?.[0]?.segments.some((segment) => segment.kind !== 'line'),
    ).toBe(true);
    // One polyline per curve, so tab anchors and polyline readers line up.
    for (const path of converted.paths) {
      expect(path.polylines).toHaveLength(path.curves?.length ?? 0);
    }
    expect(burnDifference(burned(source), burned(converted))).toBeLessThan(BURN_MATCH_MM);
    expect(st().undoStack).toHaveLength(1);
  });

  it('converts everything selected in one undo step, keeping variable text as text', () => {
    const variable = {
      ...curvedText('VT'),
      content: 'SN {{serial:4}}',
      variableTemplate: {
        tokens: [
          { kind: 'literal', value: 'SN ' },
          { kind: 'serial', prefix: '', width: 4 },
        ],
      },
    } as unknown as TextObject;
    const sources = [circle('A'), curvedSvg('B'), variable];
    load(sources);
    const before = st().project;

    st().convertSelectionToPath();

    for (const id of ['A', 'B']) {
      const converted = convertedById(id);
      expect(converted.paths[0]?.curves).toBeDefined();
      expect(segmentCount(converted)).toBeGreaterThan(0);
      expect(segmentCount(converted)).toBeLessThanOrEqual(8);
    }
    expect(st().project.scene.objects.find((object) => object.id === 'VT')?.kind).toBe('text');
    expect(st().undoStack).toHaveLength(1);
    st().undo();
    expect(st().project.scene.objects).toEqual(before.scene.objects);
  });

  it('burns a converted circle round when it is scaled up afterwards', () => {
    // The audit's oracle: a 10 mm circle converted, then scaled x10, burned
    // 0.247 mm off-round as chords, against 0.025 mm unconverted.
    const source = {
      ...createEllipse({ id: 'C', color: '#000000', spec: { widthMm: 10, heightMm: 10 } }),
      transform: { ...IDENTITY_TRANSFORM, x: 20, y: 20 },
      operationIds: ['art'],
    };
    load([source]);
    st().convertSelectionToPath();
    const converted = convertedById('C');
    // Both scaled x10 about the circle's centre (25, 25): radius 50.
    const scaled: ImportedSvg = {
      ...converted,
      transform: { ...IDENTITY_TRANSFORM, scaleX: 10, scaleY: 10, x: -225, y: -225 },
    };
    const original = {
      ...source,
      transform: { ...IDENTITY_TRANSFORM, scaleX: 10, scaleY: 10, x: -25, y: -25 },
    };
    const offRound = (object: SceneObject): number => {
      let worst = 0;
      for (const polyline of burned(object)) {
        for (const point of polyline.points) {
          worst = Math.max(worst, Math.abs(Math.hypot(point.x - 25, point.y - 25) - 50));
        }
      }
      return worst;
    };
    expect(offRound(original)).toBeLessThan(0.03);
    expect(offRound(scaled)).toBeLessThan(offRound(original) + 0.001);
    expect(burnDifference(burned(original), burned(scaled))).toBeLessThan(BURN_MATCH_MM);
  });

  it.each([
    [
      'circle',
      () => createEllipse({ id: 'C', color: '#000000', spec: { widthMm: 40, heightMm: 40 } }),
    ],
    [
      'rounded rectangle',
      () =>
        createRectangle({
          id: 'C',
          color: '#000000',
          spec: { widthMm: 40, heightMm: 25, cornerRadiusMm: 5 },
        }),
    ],
  ])('keeps the native G2/G3 arcs of a converted %s', (_name, make) => {
    const shape = { ...make(), transform: { ...IDENTITY_TRANSFORM, x: 50, y: 50 } };
    load([{ ...shape, operationIds: ['art'] }]);
    const project = st().project;
    useStore.setState({
      project: {
        ...project,
        device: { ...project.device, controllerKind: 'grbl-v1.1', laserArcMoves: 'on' },
      },
    });
    const arcsBefore = arcMoves(st().project);
    expect(arcsBefore).toBeGreaterThan(0);

    st().convertSelectionToPath();

    expect(arcMoves(st().project)).toBe(arcsBefore);
  });

  it('keeps an unplaced circle exactly where it was', () => {
    const source = circle('C', IDENTITY_TRANSFORM);
    load([source]);
    st().convertSelectionToPath();
    const converted = convertedById('C');
    expect(converted.paths[0]?.curves).toEqual((source as ImportedSvg).paths[0]?.curves);
  });
});
