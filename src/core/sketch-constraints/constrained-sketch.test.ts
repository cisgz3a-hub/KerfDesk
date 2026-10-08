import { describe, it, expect } from 'vitest';
import { defaultConstrainedSketch } from './default-constrained-sketch';
import { solveConstrainedSketch } from './solve-constrained-sketch';
import { resolveSketchParameters } from './sketch-parameters';
import {
  materializeConstrainedSketch,
  sketchGeometryMatches,
} from './materialize-constrained-sketch';
import { IDENTITY_TRANSFORM, type ImportedSvg, createProject } from '../scene';
import { deserializeProject, serializeProject } from '../../io/project';
describe('bounded dimensional sketch', () => {
  it('solves a 60 to 75 mm bracket against independent fractional-hole coordinates', () => {
    const draft = defaultConstrainedSketch();
    const solved = solveConstrainedSketch({
      ...draft,
      parameters: draft.parameters.map((p) => (p.name === 'width' ? { ...p, value: 75 } : p)),
    });
    expect(solved).toMatchObject({
      kind: 'solved',
      status: 'fully-constrained',
      degreesOfFreedom: 0,
    });
    if (solved.kind !== 'solved') throw new Error(solved.reason);
    expect(solved.sketch.points.find((p) => p.id === 'hole1')?.x).toBeCloseTo(18.75, 5);
    expect(solved.sketch.points.find((p) => p.id === 'hole2')?.x).toBeCloseTo(56.25, 5);
    expect(solved.sketch.points.find((p) => p.id === 'c')?.x).toBeCloseTo(75, 5);
    expect(solved.sketch.circles[0]?.radiusMm).toBeCloseTo(2, 5);
    expect(solved.maximumResidualMm).toBeLessThan(1e-5);
  });
  it('reports unconstrained freedom and named incompatible residuals without geometry', () => {
    const sketch = defaultConstrainedSketch();
    expect(solveConstrainedSketch({ ...sketch, constraints: [] })).toMatchObject({
      kind: 'solved',
      status: 'under-constrained',
      degreesOfFreedom: 14,
    });
    const conflict = materializeConstrainedSketch(
      {
        ...sketch,
        constraints: [
          ...sketch.constraints,
          { id: 'impossible-width', kind: 'x', pointId: 'b', value: 80 },
        ],
      },
      '#000000',
    );
    expect(conflict.paths).toBeUndefined();
    if (conflict.result.kind !== 'solved') throw new Error('missing conflict result');
    expect(conflict.result.status).toBe('over-constrained');
    expect(conflict.result.conflicts.map((c) => c.constraintId)).toContain('impossible-width');
    expect(conflict.result.maximumResidualMm).toBeGreaterThan(1);
  });
  it('solves geometric relations on initially free points', () => {
    const sketch = {
      version: 1 as const,
      name: 'right triangle',
      parameters: [],
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 4, y: 1 },
        { id: 'c', x: 5, y: 5 },
      ],
      lines: [
        { id: 'ab', first: 'a', second: 'b' },
        { id: 'bc', first: 'b', second: 'c' },
      ],
      circles: [],
      profiles: [{ id: 'triangle', pointIds: ['a', 'b', 'c'], closed: true }],
      constraints: [
        { id: 'anchor-x', kind: 'x' as const, pointId: 'a', value: 0 },
        { id: 'anchor-y', kind: 'y' as const, pointId: 'a', value: 0 },
        { id: 'horizontal', kind: 'horizontal' as const, lineId: 'ab' },
        { id: 'vertical', kind: 'vertical' as const, lineId: 'bc' },
        { id: 'equal', kind: 'equal' as const, firstLineId: 'ab', secondLineId: 'bc' },
        { id: 'width', kind: 'distance' as const, first: 'a', second: 'b', value: 8 },
      ],
    };
    const result = solveConstrainedSketch(sketch);
    expect(result).toMatchObject({ kind: 'solved', status: 'fully-constrained' });
    if (result.kind !== 'solved') throw new Error(result.reason);
    expect(result.sketch.points[1]?.x).toBeCloseTo(8, 5);
    expect(result.sketch.points[2]?.y).toBeCloseTo(8, 5);
  });
  it('checks expression units, cycles and invalid arithmetic without evaluating JavaScript', () => {
    const params = defaultConstrainedSketch().parameters;
    const result = resolveSketchParameters([
      ...params,
      { name: 'offset', unit: 'mm', value: 'width/4 + 2mm' },
    ]);
    if (result.kind !== 'ok') throw new Error(result.reason);
    expect(result.values.get('offset')?.value).toBe(17);
    for (const value of ['width+5', 'Math.random()', '1/0', 'height*width'])
      expect(resolveSketchParameters([...params, { name: 'bad', unit: 'mm', value }]).kind).toBe(
        'error',
      );
    expect(
      resolveSketchParameters([
        { name: 'a', unit: 'mm', value: 'b' },
        { name: 'b', unit: 'mm', value: 'a' },
      ]),
    ).toMatchObject({ kind: 'error', reason: expect.stringContaining('Cyclic') });
  });
  it('cold reopens canonical curves and preserves bindings when dimensions change', () => {
    const built = materializeConstrainedSketch(defaultConstrainedSketch(), '#000000');
    if (built.result.kind !== 'solved' || built.paths === undefined || built.bounds === undefined)
      throw new Error('no geometry');
    const object: ImportedSvg = {
      kind: 'imported-svg',
      id: 'sketch',
      source: 'bracket',
      transform: IDENTITY_TRANSFORM,
      paths: built.paths.map((p, i) => ({ ...p, operationIds: [i === 0 ? 'profile' : 'holes'] })),
      bounds: built.bounds,
      constrainedSketch: built.result.sketch,
    };
    const project = createProject(),
      reopened = deserializeProject(
        serializeProject({ ...project, scene: { ...project.scene, objects: [object] } }),
      );
    if (reopened.kind !== 'ok') throw new Error(JSON.stringify(reopened));
    const loaded = reopened.project.scene.objects[0] as ImportedSvg;
    expect(sketchGeometryMatches(loaded)).toBe(true);
    const savedSketch = loaded.constrainedSketch;
    if (savedSketch === undefined) throw new Error('Missing retained sketch');
    const changed = {
      ...savedSketch,
      parameters: savedSketch.parameters.map((p) => (p.name === 'width' ? { ...p, value: 75 } : p)),
    };
    expect(
      materializeConstrainedSketch(changed, '#000000', loaded).paths?.map((p) => p.operationIds),
    ).toEqual([['profile'], ['holes'], ['holes']]);
    expect(sketchGeometryMatches({ ...loaded, paths: loaded.paths.slice(0, 1) })).toBe(false);
  });
});
