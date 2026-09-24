import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type Layer,
  type Project,
  type SceneObject,
  type Transform,
  type Vec2,
} from '../../core/scene';
import { createPenPath, type PenNode } from '../../core/shapes/pen-path';
import type { PenDraft, PenEndpointRef } from '../workspace/pen-draft';
import { planPenCommit, type PenCommitPlan } from './pen-path-join';

const BLACK = createLayer({ id: 'black', color: '#000000' });
const RED = createLayer({ id: 'red', color: '#ff0000' });

describe('planPenCommit (ADR-380)', () => {
  it('draws a new shape through the clicked corners when nothing is continued or joined', () => {
    const plan = plan_({ project: projectWith([]), draft: draft([p(0, 0), p(10, 0), p(10, 10)]) });

    expect(plan?.kind).toBe('new-shape');
    const curve = plan?.kind === 'new-shape' ? plan.shape.paths[0]?.curves?.[0] : undefined;
    expect(curve).toEqual(lines([p(0, 0), p(10, 0), p(10, 10)]));
  });

  it('extends the path it continued from, keeping its start and direction', () => {
    const project = projectWith([pen('a', [p(0, 0), p(10, 0)])]);

    const plan = plan_({
      project,
      draft: draft([p(10, 0), p(10, 10), p(20, 10)], end('a', 'end', p(10, 0))),
    });

    expect(curveOf(plan, 'a')).toEqual(lines([p(0, 0), p(10, 0), p(10, 10), p(20, 10)]));
    expect(plan?.kind === 'merge' ? plan.selectId : null).toBe('a');
  });

  it('extends backwards from the start without flipping the path', () => {
    const project = projectWith([pen('a', [p(0, 0), p(10, 0)])]);

    const plan = plan_({
      project,
      draft: draft([p(0, 0), p(0, 10), p(-10, 10)], end('a', 'start', p(0, 0))),
    });

    expect(curveOf(plan, 'a')).toEqual(lines([p(-10, 10), p(0, 10), p(0, 0), p(10, 0)]));
  });

  it("joins a path by finishing on its end, keeping that path's start", () => {
    const project = projectWith([pen('a', [p(0, 0), p(10, 0)])]);

    const plan = plan_({
      project,
      draft: draft([p(30, 0), p(20, 5), p(10, 0)]),
      joinTo: end('a', 'end', p(10, 0)),
    });

    expect(curveOf(plan, 'a')).toEqual(lines([p(0, 0), p(10, 0), p(20, 5), p(30, 0)]));
  });

  it('absorbs the path it joins when both cut the same way', () => {
    const project = projectWith([pen('a', [p(0, 0), p(10, 0)]), pen('b', [p(20, 0), p(30, 0)])]);

    const plan = bridge(project);

    expect(curveOf(plan, 'a')).toEqual(lines([p(0, 0), p(10, 0), p(15, 5), p(20, 0), p(30, 0)]));
    expect(replacementsOf(plan).get('b')).toBeNull();
  });

  it('absorbs a path on another operation with identical settings', () => {
    const project = projectWith(
      [pen('a', [p(0, 0), p(10, 0)]), pen('b', [p(30, 0), p(20, 0)], '#ff0000')],
      [BLACK, RED],
    );

    const plan = bridge(project, end('b', 'end', p(20, 0)));

    expect(curveOf(plan, 'a')).toEqual(lines([p(0, 0), p(10, 0), p(15, 5), p(20, 0), p(30, 0)]));
    expect(replacementsOf(plan).get('b')).toBeNull();
  });

  it('meets but leaves separate a path whose operation cuts differently', () => {
    const project = projectWith(
      [pen('a', [p(0, 0), p(10, 0)]), pen('b', [p(20, 0), p(30, 0)], '#ff0000')],
      [BLACK, { ...RED, passes: RED.passes + 1 }],
    );

    const plan = bridge(project);

    expect(curveOf(plan, 'a')).toEqual(lines([p(0, 0), p(10, 0), p(15, 5), p(20, 0)]));
    expect(replacementsOf(plan).has('b')).toBe(false);
  });

  it('leaves artwork that masks an image separate', () => {
    const project = projectWith([
      pen('a', [p(0, 0), p(10, 0)]),
      pen('b', [p(20, 0), p(30, 0)]),
      maskedImage('photo', 'b'),
    ]);

    const plan = bridge(project);

    expect(curveOf(plan, 'a')).toEqual(lines([p(0, 0), p(10, 0), p(15, 5), p(20, 0)]));
    expect(replacementsOf(plan).has('b')).toBe(false);
  });

  it('moves only the joined stroke out of multi-stroke artwork', () => {
    const art = svg('b', [
      [p(20, 0), p(30, 0)],
      [p(20, 20), p(30, 20)],
    ]);
    const project = projectWith([pen('a', [p(0, 0), p(10, 0)]), art]);

    const plan = bridge(project);

    expect(curveOf(plan, 'a')).toEqual(lines([p(0, 0), p(10, 0), p(15, 5), p(20, 0), p(30, 0)]));
    const rest = replacementsOf(plan).get('b');
    expect(rest?.kind === 'imported-svg' ? rest.paths[0]?.polylines : null).toEqual([
      { points: [p(20, 20), p(30, 20)], closed: false },
    ]);
  });

  it('closes the continued path when finishing on its other end', () => {
    const project = projectWith([pen('a', [p(0, 0), p(10, 0), p(10, 10)])]);

    const plan = plan_({
      project,
      draft: draft([p(10, 10), p(0, 10), p(0, 0)], end('a', 'end', p(10, 10))),
      joinTo: end('a', 'start', p(0, 0)),
    });

    expect(curveOf(plan, 'a')).toEqual({
      ...lines([p(0, 0), p(10, 0), p(10, 10), p(0, 10), p(0, 0)]),
      closed: true,
    });
  });

  it('places the new nodes where they were clicked on moved and scaled artwork', () => {
    const moved: Transform = { ...IDENTITY_TRANSFORM, x: 100, y: 50, scaleX: 2, scaleY: 0.5 };
    const project = projectWith([{ ...pen('a', [p(0, 0), p(10, 0)]), transform: moved }]);
    const tip = applyTransform(p(10, 0), moved);
    const clicks = [tip, p(tip.x, tip.y + 10), p(tip.x + 10, tip.y + 10)];

    const plan = plan_({ project, draft: draft(clicks, end('a', 'end', tip)) });

    const curve = curveOf(plan, 'a');
    const scene = (curve?.segments ?? []).map((segment) => applyTransform(segment.to, moved));
    expect(scene).toHaveLength(3);
    scene.forEach((point, index) => {
      const click = clicks[index]!;
      expect(point.x).toBeCloseTo(click.x, 9);
      expect(point.y).toBeCloseTo(click.y, 9);
    });
  });

  it('absorbs unstroked artwork from another transform where it was drawn', () => {
    const shifted: Transform = { ...IDENTITY_TRANSFORM, x: 5, y: 0 };
    const project = projectWith([
      pen('a', [p(0, 0), p(10, 0)]),
      { ...pen('b', [p(15, 0), p(25, 0)]), transform: shifted },
    ]);

    const plan = bridge(project);

    expect(curveOf(plan, 'a')).toEqual(lines([p(0, 0), p(10, 0), p(15, 5), p(20, 0), p(30, 0)]));
  });

  it('keeps stroked artwork from another transform separate', () => {
    const shifted: Transform = { ...IDENTITY_TRANSFORM, x: 5, y: 0 };
    const stroked = svg('b', [[p(15, 0), p(25, 0)]], { strokeWidthMm: 1 });
    const project = projectWith([
      pen('a', [p(0, 0), p(10, 0)]),
      { ...stroked, transform: shifted },
    ]);

    const plan = bridge(project);

    expect(replacementsOf(plan).has('b')).toBe(false);
  });

  it('draws a separate shape when the continued end is no longer there', () => {
    const project = projectWith([pen('a', [p(0, 0), p(10, 0)])]);

    const plan = plan_({
      project,
      draft: draft([p(11, 0), p(20, 0)], end('a', 'end', p(11, 0))),
    });

    expect(plan?.kind).toBe('new-shape');
  });

  it('never extends locked artwork', () => {
    const project = projectWith([{ ...pen('a', [p(0, 0), p(10, 0)]), locked: true }]);

    const plan = plan_({
      project,
      draft: draft([p(10, 0), p(20, 0)], end('a', 'end', p(10, 0))),
    });

    expect(plan?.kind).toBe('new-shape');
  });

  it('needs two nodes to finish open and three to close', () => {
    const project = projectWith([]);

    expect(plan_({ project, draft: draft([p(0, 0)]) })).toBeNull();
    expect(plan_({ project, draft: draft([p(0, 0), p(10, 0)]), closed: true })).toBeNull();
  });
});

// Continue a:end at (10,0) through (15,5) and finish on b at (20,0).
function bridge(project: Project, joinTo = end('b', 'start', p(20, 0))): PenCommitPlan | null {
  return plan_({
    project,
    draft: draft([p(10, 0), p(15, 5), p(20, 0)], end('a', 'end', p(10, 0))),
    joinTo,
  });
}

function plan_(args: {
  readonly project: Project;
  readonly draft: PenDraft;
  readonly joinTo?: PenEndpointRef;
  readonly closed?: boolean;
}): PenCommitPlan | null {
  return planPenCommit({
    project: args.project,
    draft: args.draft,
    closed: args.closed ?? false,
    ...(args.joinTo === undefined ? {} : { joinTo: args.joinTo }),
    id: 'new',
    color: '#000000',
  });
}

function replacementsOf(plan: PenCommitPlan | null): ReadonlyMap<string, SceneObject | null> {
  if (plan?.kind !== 'merge') throw new Error(`expected a merge, got ${plan?.kind ?? 'null'}`);
  return plan.replacements;
}

function curveOf(plan: PenCommitPlan | null, id: string): CurveSubpath | undefined {
  const object = replacementsOf(plan).get(id);
  return object !== null && object !== undefined && 'paths' in object
    ? object.paths[0]?.curves?.[0]
    : undefined;
}

function p(x: number, y: number): Vec2 {
  return { x, y };
}

function lines(points: ReadonlyArray<Vec2>): CurveSubpath {
  return {
    start: points[0]!,
    segments: points.slice(1).map((to) => ({ kind: 'line', to })),
    closed: false,
  };
}

function corners(points: ReadonlyArray<Vec2>): PenNode[] {
  return points.map((point) => ({ kind: 'corner', point }));
}

function draft(points: ReadonlyArray<Vec2>, continues?: PenEndpointRef): PenDraft {
  return { nodes: corners(points), ...(continues === undefined ? {} : { continues }) };
}

function end(objectId: string, which: PenEndpointRef['end'], point: Vec2): PenEndpointRef {
  return { objectId, pathIndex: 0, curveIndex: 0, end: which, point };
}

function pen(id: string, points: ReadonlyArray<Vec2>, color = '#000000'): SceneObject {
  const shape = createPenPath({ id, color, nodes: corners(points), closed: false });
  if (shape === null) throw new Error('fixture');
  return shape;
}

function svg(
  id: string,
  strokes: ReadonlyArray<ReadonlyArray<Vec2>>,
  style: { readonly strokeWidthMm?: number } = {},
): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 40 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: strokes.map((points) => ({ points, closed: false })),
        ...style,
      },
    ],
  };
}

function maskedImage(id: string, maskId: string): SceneObject {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    pixelWidth: 10,
    pixelHeight: 10,
    bounds: { minX: 50, minY: 50, maxX: 60, maxY: 60 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
    imageMaskId: maskId,
  };
}

function projectWith(
  objects: ReadonlyArray<SceneObject>,
  layers: ReadonlyArray<Layer> = [BLACK],
): Project {
  const project = createProject();
  return { ...project, scene: { objects, layers } };
}
