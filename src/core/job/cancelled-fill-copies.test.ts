// L8-P1-1 extension (rolling audit v7): Duplicate or Paste in Place on a Fill
// part leaves two copies that cancel under the pooled even-odd fill, and the
// part burns nothing (12,000 mm of hatch to 0) with no warning (ADR-683).
import { describe, expect, it } from 'vitest';
import { runPreflight } from '../preflight/preflight';
import { createRectangle } from '../shapes/primitives';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type Layer,
  type Polyline,
  type Project,
  type SceneObject,
} from '../scene';
import { cancelledFillCopies } from './cancelled-fill-copies';
import { compileJob } from './compile-job';

const fill: Layer = {
  ...createLayer({ id: 'plate-op', color: '#000000', mode: 'fill' }),
  hatchSpacingMm: 0.5,
};
const line = createLayer({ id: 'line-op', color: '#ff0000', mode: 'line' });

function plate(id: string, x = 10, color = '#000000'): SceneObject {
  return createRectangle({
    id,
    color,
    spec: { widthMm: 40, heightMm: 30, cornerRadiusMm: 0 },
    transform: { ...IDENTITY_TRANSFORM, x, y: 10 },
  });
}

function project(
  objects: ReadonlyArray<SceneObject>,
  layers: ReadonlyArray<Layer> = [fill, line],
): Project {
  return { ...createProject(), scene: { ...createProject().scene, layers, objects } };
}

function hatchLengthMm(current: Project): number {
  return compileJob(current.scene, current.device).groups.reduce(
    (sum, group) =>
      group.kind !== 'fill'
        ? sum
        : sum +
          group.segments.reduce((total, segment) => {
            const [a, b] = segment.polyline;
            return a === undefined || b === undefined
              ? total
              : total + Math.hypot(b.x - a.x, b.y - a.y);
          }, 0),
    0,
  );
}

describe('stacked copies on a Fill operation', () => {
  it('reports a duplicated Fill plate, which burns nothing, as Start and Save advisories', () => {
    const once = project([plate('plate'), plate('mark', 80, '#ff0000')]);
    const twice = project([plate('plate'), plate('copy'), plate('mark', 80, '#ff0000')]);
    expect(hatchLengthMm(once)).toBeGreaterThan(1000);
    expect(hatchLengthMm(twice)).toBe(0);

    expect(cancelledFillCopies(once.scene)).toEqual([]);
    expect(cancelledFillCopies(twice.scene)).toEqual([
      { operationName: fill.name, objectIds: ['plate', 'copy'] },
    ]);
    const advisory = runPreflight(twice, 'G1 X1 S1').issues.find(
      (issue) => issue.code === 'fill-stacked-copies-cancel',
    );
    expect(advisory?.message).toMatch(/^2 stacked copies on Fill operation ".+" burn nothing\./);
    expect(advisory?.message).toContain('Delete Duplicates');
  });

  it('keeps quiet when an odd number of copies still burns once', () => {
    const thrice = project([plate('plate'), plate('copy'), plate('copy-2')]);
    expect(hatchLengthMm(thrice)).toBeGreaterThan(1000);
    expect(cancelledFillCopies(thrice.scene)).toEqual([]);
  });

  it('finds a copy drawn from another corner, the other way round, with no repeated start point', () => {
    const original = plate('plate');
    const seamed = (original as Extract<SceneObject, { kind: 'shape' }>).paths[0]
      ?.polylines[0] as Polyline;
    const ring = { ...seamed, points: seamed.points.slice(0, -1) };
    const redrawn: SceneObject = {
      kind: 'imported-svg',
      id: 'redrawn',
      source: 'redrawn.svg',
      bounds: { minX: 10, minY: 10, maxX: 50, maxY: 40 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        {
          color: '#000000',
          polylines: [
            {
              closed: true,
              points: [...ring.points.slice(2), ...ring.points.slice(0, 2)]
                .map((point) => ({ x: point.x + 10, y: point.y + 10 }))
                .reverse(),
            },
          ],
        },
      ],
    };
    expect(cancelledFillCopies(project([original, redrawn]).scene)).toEqual([
      { operationName: fill.name, objectIds: ['plate', 'redrawn'] },
    ]);
  });

  it('ignores copies on a Line operation, on separate operations, and a nudged copy', () => {
    const lineCopies = project([plate('a', 10, '#ff0000'), plate('b', 10, '#ff0000')]);
    const red = createLayer({ id: 'red-fill', color: '#ff0000', mode: 'fill' });
    const apart = project([plate('a'), plate('b', 10, '#ff0000')], [fill, red]);
    const nudged = project([plate('a'), plate('b', 11)]);
    expect(cancelledFillCopies(lineCopies.scene)).toEqual([]);
    expect(cancelledFillCopies(apart.scene)).toEqual([]);
    expect(cancelledFillCopies(nudged.scene)).toEqual([]);
  });

  it('says nothing on a CNC machine, which cuts its exact copies once', () => {
    const twice = project([plate('plate'), plate('copy')]);
    const cnc: Project = { ...twice, machine: DEFAULT_CNC_MACHINE_CONFIG };
    const codes = runPreflight(cnc, 'G1 X1 S1').issues.map((issue) => issue.code);
    expect(codes).not.toContain('fill-stacked-copies-cancel');
  });
});
