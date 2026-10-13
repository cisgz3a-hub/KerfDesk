import { expect, it } from 'vitest';
import { createProject, IDENTITY_TRANSFORM, type ImportedSvg } from '../scene';
import { createLayer } from '../scene/layer';
import { compileJob } from './compile-job';
import { optimizePaths } from './optimize-paths';

function box(id: string, y: number): ImportedSvg {
  const points = [
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    { x: 5, y: 5 },
    { x: 0, y: 5 },
    { x: 0, y: 0 },
  ];
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 },
    transform: { ...IDENTITY_TRANSFORM, x: 10, y },
    operationIds: ['cut'],
    paths: [{ color: '#000000', polylines: [{ closed: true, points }] }],
  };
}

it('applies the sweep through the real compile and planner with inside-first on', () => {
  const project = createProject();
  const scene = {
    objects: [box('a', 50), box('b', 10), box('c', 90)],
    layers: [createLayer({ id: 'cut', color: '#000000' })],
    groups: [],
  };
  const job = compileJob(scene, project.device);
  const planned = optimizePaths(job, {
    ...project.optimization,
    insideFirst: true,
    cutDirection: 'top-to-bottom',
  });
  const ys = planned.groups
    .flatMap((group) => (group.kind === 'cut' ? group.segments : []))
    .map((segment) => Math.max(...segment.polyline.map((point) => point.y)));
  // Workspace top first: box b (scene y 10) is nearest the back of a front-left bed.
  expect(ys).toEqual([...ys].sort((p, q) => q - p));
});
