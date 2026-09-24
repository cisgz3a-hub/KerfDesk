import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  type PathSegment,
  type Project,
  type SceneObject,
  type ShapeObject,
  type Vec2,
} from '../../core/scene';
import { createPolyline, CURRENT_POLYLINE_FAIRING_VERSION } from '../../core/shapes';
import { createPenPath } from '../../core/shapes/pen-path';
import { deserializeProject, serializeProject } from '../../io/project';
import { planPenCommit } from './pen-path-join';
import { upgradeProjectPolylineFairing } from './polyline-fairing-upgrade';

// Pen drawings saved before ADR-380 were refitted into smooth curves when they
// were drawn. Loading them must keep that stored geometry exactly, and the
// exact corner drawings the pen now makes must never be refitted either.
describe('pen drawings across load (ADR-380)', () => {
  it('loads a faired pen drawing from an earlier release unchanged', () => {
    const open = createPolyline({ id: 'open', color: '#000000', spec: bends(false) });
    const closed = createPolyline({ id: 'closed', color: '#000000', spec: bends(true) });
    expect(hasCubic(open) && hasCubic(closed)).toBe(true);

    const loaded = load(projectWith(open, closed));

    expect(geometry(loaded.scene.objects[0])).toEqual(geometry(open));
    expect(geometry(loaded.scene.objects[1])).toEqual(geometry(closed));
  });

  it('never refits the corners of an exact pen drawing', () => {
    const drawing = createPenPath({
      id: 'exact',
      color: '#000000',
      nodes: bends(false).points.map((point) => ({ kind: 'corner', point })),
      closed: false,
    });
    if (drawing === null) throw new Error('fixture');

    const loaded = load(projectWith(drawing));

    expect(geometry(loaded.scene.objects[0])).toEqual(geometry(drawing));
    expect(hasCubic(drawing)).toBe(false);
  });

  it('keeps the faired curves of an earlier drawing that the pen continues', () => {
    const earlier = createPolyline({ id: 'earlier', color: '#000000', spec: bends(false) });

    const continued = continueTo(earlier, { x: 150, y: 80 });

    const before = segmentsOf(earlier);
    const after = segmentsOf(continued);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length)).toEqual([{ kind: 'line', to: { x: 150, y: 80 } }]);
    expect(continued.fairingVersion).toBe(CURRENT_POLYLINE_FAIRING_VERSION);
    expect(geometry(load(projectWith(continued)).scene.objects[0])).toEqual(geometry(continued));
  });
});

// Extend the drawing from its end (120, 80) with one clicked corner.
function continueTo(drawing: ShapeObject, point: Vec2): ShapeObject {
  const tip = { x: 120, y: 80 };
  const plan = planPenCommit({
    project: projectWith(drawing),
    draft: {
      nodes: [
        { kind: 'corner', point: tip },
        { kind: 'corner', point },
      ],
      continues: { objectId: drawing.id, pathIndex: 0, curveIndex: 0, end: 'end', point: tip },
    },
    closed: false,
    id: 'unused',
    color: '#000000',
  });
  const continued = plan?.kind === 'merge' ? plan.replacements.get(drawing.id) : undefined;
  if (continued?.kind !== 'shape') throw new Error('expected the drawing to be extended');
  return continued;
}

function segmentsOf(object: ShapeObject): ReadonlyArray<PathSegment> {
  return object.paths[0]?.curves?.[0]?.segments ?? [];
}

// Save, reopen and run the fairing migration the app runs on every project.
function load(project: Project): Project {
  const reopened = deserializeProject(serializeProject(project));
  if (reopened.kind !== 'ok') throw new Error(JSON.stringify(reopened));
  const upgraded = upgradeProjectPolylineFairing(reopened.project);
  expect(upgraded.upgradedCount).toBe(0);
  return upgraded.project;
}

function geometry(object: SceneObject | undefined): unknown {
  if (object?.kind !== 'shape') return object;
  return {
    spec: object.spec,
    bounds: object.bounds,
    transform: object.transform,
    curves: object.paths.map((path) => path.curves),
    polylines: object.paths.map((path) => path.polylines),
    fairingVersion: object.fairingVersion,
  };
}

function hasCubic(object: ShapeObject): boolean {
  return object.paths.some((path) =>
    path.curves?.some((curve) => curve.segments.some((segment) => segment.kind === 'cubic')),
  );
}

function bends(closed: boolean): {
  readonly points: ReadonlyArray<Vec2>;
  readonly closed: boolean;
} {
  return {
    points: [
      { x: 0, y: 80 },
      { x: 30, y: 20 },
      { x: 60, y: 80 },
      { x: 90, y: 20 },
      { x: 120, y: 80 },
    ],
    closed,
  };
}

function projectWith(...objects: ReadonlyArray<ShapeObject>): Project {
  const project = createProject();
  return {
    ...project,
    scene: { objects, layers: [createLayer({ id: '#000000', color: '#000000' })] },
  };
}
