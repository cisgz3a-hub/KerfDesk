import { describe, expect, it } from 'vitest';
import { cncTabAnchorPosition } from '../../core/cnc';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type CurveSubpath,
  type ImportedSvg,
  type Project,
  type Transform,
} from '../../core/scene';
import { prepareOutput } from '../../io/gcode/prepare-output';
import { deserializeProject, serializeProject } from '../../io/project';
import type { PathNodeRef } from './path-node-edit-actions';
import { planCurveNodeJoin } from './path-node-curve-join-plan';

const TRANSFORM: Transform = {
  x: 120,
  y: 80,
  scaleX: 2,
  scaleY: 3,
  rotationDeg: 37,
  mirrorX: true,
  mirrorY: false,
};

describe('curve-node Join plan', () => {
  it.each([
    { firstPoint: 0, secondPoint: 0, expectedStart: 8, expectedEnd: 28 },
    { firstPoint: 0, secondPoint: 1, expectedStart: 8, expectedEnd: 20 },
    { firstPoint: 1, secondPoint: 0, expectedStart: 0, expectedEnd: 28 },
    { firstPoint: 1, secondPoint: 1, expectedStart: 0, expectedEnd: 20 },
  ])(
    'keeps endpoints $firstPoint/$secondPoint click-order and compiled-source-order independent',
    ({ firstPoint, secondPoint, expectedStart, expectedEnd }) => {
      const project = projectWith(
        imported('curve', [[lineCurve(0, 8), lineCurve(100, 108), lineCurve(20, 28)]], TRANSFORM),
      );
      const aThenC = successfulPlan(project, [anchor(0, firstPoint), anchor(2, secondPoint)]);
      const cThenA = successfulPlan(project, [anchor(2, secondPoint), anchor(0, firstPoint)]);

      expect(cThenA.object).toEqual(aThenC.object);
      expect(aThenC.object.transform).toEqual(TRANSFORM);
      expect(aThenC.object.paths[0]).toMatchObject({
        operationIds: ['line'],
        strokeWidthMm: 0.4,
      });
      const joinedCurve = aThenC.object.paths[0]?.curves?.[0];
      expect(joinedCurve?.start.x).toBe(expectedStart);
      expect(joinedCurve?.segments.at(-1)?.to.x).toBe(expectedEnd);
      expect(aThenC.object.paths[0]?.curves?.map((curve) => curve.start.x)).toEqual([
        expectedStart,
        100,
      ]);
      expect(aThenC.object.paths[0]?.polylines.map((polyline) => polyline.points[0]?.x)).toEqual([
        expectedStart,
        100,
      ]);

      const aThenCProject = replaceObject(project, aThenC);
      const cThenAProject = replaceObject(project, cThenA);
      expect(preparedCutSegments(cThenAProject)).toEqual(preparedCutSegments(aThenCProject));
      expect(preparedCutSegments(aThenCProject)).toHaveLength(2);

      const reopened = deserializeProject(serializeProject(aThenCProject));
      expect(reopened.kind).toBe('ok');
      if (reopened.kind !== 'ok') return;
      expect(importedObject(reopened.project).paths).toEqual(aThenC.object.paths);
      expect(preparedCutSegments(reopened.project)).toEqual(preparedCutSegments(aThenCProject));
    },
  );

  it('keeps manual CNC tabs attached to an untouched later contour when Join removes an index', () => {
    const object = {
      ...imported('curve', [[lineCurve(0, 8), lineCurve(20, 28), squareCurve(50)]]),
      cncTabAnchors: [
        { layerColor: '#000000', pathIndex: 0, polylineIndex: 1, pathT: 0.5 },
        { layerColor: '#000000', pathIndex: 0, polylineIndex: 2, pathT: 0.25 },
      ],
    };
    const retainedBefore = cncTabAnchorPosition(object, object.cncTabAnchors[1]!);
    const result = successfulPlan(projectWith(object), [anchor(0, 1), anchor(1, 0)]);

    expect(result.object.cncTabAnchors).toEqual([
      { layerColor: '#000000', pathIndex: 0, polylineIndex: 1, pathT: 0.25 },
    ]);
    expect(cncTabAnchorPosition(result.object, result.object.cncTabAnchors![0]!)).toEqual(
      retainedBefore,
    );
  });

  it('derives joined bounds from canonical curve extrema under high physical scale', () => {
    const object = imported('curve', [[archedCubic(), lineCurve(10, 12)]], {
      ...IDENTITY_TRANSFORM,
      scaleY: 100,
    });
    const result = successfulPlan(projectWith(object), [anchor(0, 1), anchor(1, 0)]);

    expect(result.object.bounds.maxY).toBeCloseTo(4 / 9, 12);
    expect(result.object.bounds.maxY * result.object.transform.scaleY).toBeCloseTo(400 / 9, 10);
  });
});

function successfulPlan(project: Project, refs: ReadonlyArray<PathNodeRef>) {
  const result = planCurveNodeJoin(project, refs);
  if (result.kind !== 'success') throw new Error(result.message);
  if (result.object.kind !== 'imported-svg') throw new Error('Expected imported Join result.');
  return { ...result, object: result.object };
}

function replaceObject(
  project: Project,
  result: Extract<ReturnType<typeof planCurveNodeJoin>, { readonly kind: 'success' }>,
): Project {
  return {
    ...project,
    scene: {
      ...project.scene,
      objects: project.scene.objects.map((object) =>
        object.id === result.object.id ? result.object : object,
      ),
    },
  };
}

function projectWith(object: ImportedSvg): Project {
  const base = createProject();
  return {
    ...base,
    optimization: {
      ...base.optimization,
      reduceTravelMoves: false,
      travelPolicy: 'source-order',
      pathDirection: 'preserve',
    },
    scene: {
      objects: [object],
      layers: [createLayer({ id: 'line', color: '#000000', mode: 'line' })],
      groups: [],
    },
  };
}

function imported(
  id: string,
  curvesByPath: ReadonlyArray<ReadonlyArray<CurveSubpath>>,
  transform = IDENTITY_TRANSFORM,
): ImportedSvg {
  const paths: ReadonlyArray<ColoredPath> = curvesByPath.map((curves) => ({
    color: '#000000',
    operationIds: ['line'],
    strokeWidthMm: 0.4,
    curves,
    polylines: curves.map(simplePolyline),
  }));
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 108, maxY: 10 },
    transform,
    paths,
  };
}

function anchor(polylineIndex: number, pointIndex: number): PathNodeRef {
  return { objectId: 'curve', pathIndex: 0, polylineIndex, pointIndex, geometry: 'curve' };
}

function lineCurve(startX: number, endX: number): CurveSubpath {
  return {
    start: { x: startX, y: 0 },
    segments: [{ kind: 'line', to: { x: endX, y: 0 } }],
    closed: false,
  };
}

function squareCurve(startX: number): CurveSubpath {
  return {
    start: { x: startX, y: 0 },
    segments: [
      { kind: 'line', to: { x: startX + 10, y: 0 } },
      { kind: 'line', to: { x: startX + 10, y: 10 } },
      { kind: 'line', to: { x: startX, y: 10 } },
    ],
    closed: true,
  };
}

function archedCubic(): CurveSubpath {
  return {
    start: { x: 0, y: 0 },
    segments: [
      {
        kind: 'cubic',
        control1: { x: 2, y: 1 },
        control2: { x: 4, y: 0 },
        to: { x: 6, y: 0 },
      },
    ],
    closed: false,
  };
}

function simplePolyline(curve: CurveSubpath) {
  return {
    points: [curve.start, ...curve.segments.map((segment) => segment.to)],
    closed: curve.closed,
  };
}

function importedObject(project: Project): ImportedSvg {
  const object = project.scene.objects.find((candidate) => candidate.kind === 'imported-svg');
  if (object?.kind !== 'imported-svg') throw new Error('Expected imported curve object.');
  return object;
}

function preparedCutSegments(project: Project) {
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error('Expected Join fixture to prepare.');
  const group = prepared.job.groups.find((candidate) => candidate.kind === 'cut');
  if (group?.kind !== 'cut') throw new Error('Expected prepared cut group.');
  return group.segments;
}
