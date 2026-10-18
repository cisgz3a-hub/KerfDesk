// What restacking does to the compiled job, as the Draw Order help text says:
// the run order of artwork stays, while artwork sharing one operation is one
// machining unit compiled in stacking order (ADR-211, ADR-486 Amendment 2).

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from './devices';
import { moveObjectsInDrawOrder } from './draw-order';
import { compileJob } from './job/compile-job';
import type { Job } from './job/job';
import { optimizePaths } from './job/optimize-paths';
import { createLayer, IDENTITY_TRANSFORM, type ImportedSvg, type Scene } from './scene';

const device = { ...DEFAULT_DEVICE_PROFILE, bedWidth: 200, bedHeight: 200 };

function square(id: string, at: number, size: number, operationId: string): ImportedSvg {
  return {
    id,
    kind: 'imported-svg',
    source: `${id}.svg`,
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: at, minY: at, maxX: at + size, maxY: at + size },
    operationIds: [operationId],
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: at, y: at },
              { x: at + size, y: at },
              { x: at + size, y: at + size },
              { x: at, y: at + size },
            ],
          },
        ],
      },
    ],
  };
}

// Widths of the cut shapes in the order a Keep source order job cuts them.
function cutWidths(scene: Scene): number[] {
  const job: Job = optimizePaths(compileJob(scene, device), {
    travelPolicy: 'source-order',
    insideFirst: false,
    layerPriority: 'project-order',
    pathDirection: 'allow-reverse',
    startPoint: 'machine-origin',
  });
  return job.groups.flatMap((group) =>
    group.kind === 'cut'
      ? group.segments.map((segment) => {
          const xs = segment.polyline.map((point) => point.x);
          return Math.round(Math.max(...xs) - Math.min(...xs));
        })
      : [],
  );
}

const layer = (id: string) => ({ ...createLayer({ id, color: '#000000', mode: 'line' }) });

describe('Draw Order and the compiled job', () => {
  it('keeps the run order of artwork on separate operations', () => {
    const scene: Scene = {
      objects: [square('small', 0, 10, 'a'), square('large', 50, 20, 'b')],
      layers: [layer('a'), layer('b')],
    };
    expect(cutWidths(scene)).toEqual([10, 20]);
    const restacked = moveObjectsInDrawOrder(scene, new Set(['large']), 'back');
    expect(restacked.objects.map((object) => object.id)).toEqual(['large', 'small']);
    expect(cutWidths(restacked)).toEqual([10, 20]);
  });

  it('cuts artwork sharing one operation in stacking order under Keep source order', () => {
    const scene: Scene = {
      objects: [square('small', 0, 10, 'shared'), square('large', 50, 20, 'shared')],
      layers: [layer('shared')],
    };
    expect(cutWidths(scene)).toEqual([10, 20]);
    expect(cutWidths(moveObjectsInDrawOrder(scene, new Set(['large']), 'back'))).toEqual([20, 10]);
  });
});
