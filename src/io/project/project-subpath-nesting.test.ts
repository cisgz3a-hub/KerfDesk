import { describe, expect, it } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  carriedSubpathParents,
  createLayer,
  createProject,
  withSubpathNesting,
  type ColoredPath,
  type CurveSubpath,
  type Polyline,
  type Project,
  type TracedImage,
} from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { prepareProjectForAutosave } from './prepare-project-autosave';
import { prepareProjectForPersistence } from './prepare-project-persistence';
import { serializeProject } from './serialize-project';

// ADR-406: a trace's containment forest is an optional, derived field. A
// schema-v9 project keeps it through save and load with no version change,
// in full, compact and autosave form, curved subpaths or not.

const square = (x: number, y: number, size: number): Polyline => ({
  closed: true,
  points: [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
    { x, y },
  ],
});
const disc: CurveSubpath = {
  start: { x: 15, y: 11 },
  segments: [
    { kind: 'cubic', control1: { x: 17, y: 11 }, control2: { x: 19, y: 13 }, to: { x: 19, y: 15 } },
    { kind: 'cubic', control1: { x: 19, y: 17 }, control2: { x: 17, y: 19 }, to: { x: 15, y: 19 } },
    { kind: 'line', to: { x: 15, y: 11 } },
  ],
  closed: true,
};
const polylines = [square(0, 0, 30), square(5, 5, 20), square(10, 10, 12)];

function projectWith(path: ColoredPath): Project {
  const base = createProject();
  const object: TracedImage = {
    kind: 'traced-image',
    id: 'trace',
    source: 'trace.png',
    traceMode: 'filled-contours',
    bounds: { minX: 0, minY: 0, maxX: 30, maxY: 30 },
    transform: IDENTITY_TRANSFORM,
    paths: [path],
  };
  return {
    ...base,
    scene: {
      ...base.scene,
      objects: [object],
      layers: [createLayer({ id: 'cut', color: '#000000' })],
    },
  };
}

function reloadedPath(json: string): ColoredPath {
  const result = deserializeProject(json);
  if (result.kind !== 'ok') throw new Error(JSON.stringify(result));
  const object = result.project.scene.objects[0];
  if (object?.kind !== 'traced-image') throw new Error('Expected the trace');
  return object.paths[0] as ColoredPath;
}

describe('traced containment forest persistence (ADR-406)', () => {
  it.each<[string, ColoredPath]>([
    ['straight subpaths', { color: '#000000', polylines }],
    [
      'a curved subpath',
      {
        color: '#000000',
        polylines: [...polylines.slice(0, 2), square(11, 11, 8)],
        curves: [
          {
            start: { x: 0, y: 0 },
            segments: polylines[0]!.points.slice(1).map((to) => ({ kind: 'line', to })),
            closed: true,
          },
          {
            start: { x: 5, y: 5 },
            segments: polylines[1]!.points.slice(1).map((to) => ({ kind: 'line', to })),
            closed: true,
          },
          disc,
        ],
      },
    ],
  ])('keeps the forest of %s through every save form', (_name, path) => {
    const nested = withSubpathNesting(path, [-1, 0, 1]);
    expect(carriedSubpathParents(nested)).toEqual([-1, 0, 1]);
    const project = projectWith(nested);
    const manual = prepareProjectForPersistence(project);
    const autosave = prepareProjectForAutosave(project);
    if (manual.kind !== 'ok' || autosave.kind !== 'ok') throw new Error('Save failed');
    for (const json of [
      serializeProject(project),
      serializeProject(project, { compact: true }),
      manual.json,
      autosave.json,
    ]) {
      expect(carriedSubpathParents(reloadedPath(json))).toEqual([-1, 0, 1]);
    }
  });

  it('loads a save written before the forest existed, with no forest', () => {
    const json = serializeProject(projectWith({ color: '#000000', polylines }));
    expect(json).not.toContain('subpathNesting');
    const path = reloadedPath(json);
    expect(path.polylines).toHaveLength(3);
    expect(carriedSubpathParents(path)).toBeNull();
  });

  it.each<[string, unknown]>([
    ['a non-array parents list', { parents: 'x', geometryKey: 'k' }],
    ['a parent after its child', { parents: [-1, 2, 0], geometryKey: 'k' }],
    ['a missing key', { parents: [-1, 0, 1] }],
    ['a stale key', null],
  ])('loads a save whose forest has %s and ignores the forest', (_name, broken) => {
    const nested = withSubpathNesting({ color: '#000000', polylines }, [-1, 0, 1]);
    const saved = JSON.parse(serializeProject(projectWith(nested))) as {
      scene: { objects: Array<{ paths: Array<Record<string, unknown>> }> };
    };
    const savedPath = saved.scene.objects[0]!.paths[0]!;
    if (broken === null) {
      // The geometry moved after the forest was written.
      const rings = savedPath['polylines'] as Array<{ points: Array<{ x: number }> }>;
      rings[2]!.points[0]!.x += 1;
    } else {
      savedPath['subpathNesting'] = broken;
    }
    const path = reloadedPath(JSON.stringify(saved));
    expect(path.polylines).toHaveLength(3);
    expect(carriedSubpathParents(path)).toBeNull();
  });
});
