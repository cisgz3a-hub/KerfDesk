import { describe, expect, it } from 'vitest';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { prepareOutput } from './prepare-output';

describe('prepareOutput travel policy', () => {
  it('defaults to reducing travel moves inside cut groups', () => {
    const base = travelOptimizationProject();
    const prepared = prepareOutput(base);
    const sourceOrder = prepareOutput({
      ...base,
      optimization: {
        ...base.optimization,
        reduceTravelMoves: false,
        travelPolicy: 'source-order',
      },
    });

    // Two open lines and a return to the park tie with their mirror route
    // (ADR-669), so the measure is travel, not which line goes first.
    expect(cutTravelMm(prepared)).toBeLessThan(cutTravelMm(sourceOrder) - 1);
  });

  it('preserves source cut order when reduce travel moves is disabled', () => {
    const base = travelOptimizationProject();
    const project: Project = {
      ...base,
      optimization: {
        ...base.optimization,
        reduceTravelMoves: false,
        travelPolicy: 'source-order',
      },
    };

    const prepared = prepareOutput(project);

    expect(firstCutSegmentStart(prepared)).toEqual({ x: 100, y: 300 });
  });
});

function travelOptimizationProject(): Project {
  const obj: SceneObject = {
    kind: 'imported-svg',
    id: 'O1',
    source: 'travel.svg',
    bounds: { minX: 0, minY: 100, maxX: 101, maxY: 400 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            points: [
              { x: 100, y: 100 },
              { x: 101, y: 100 },
            ],
            closed: false,
          },
          {
            points: [
              { x: 0, y: 400 },
              { x: 1, y: 400 },
            ],
            closed: false,
          },
        ],
      },
    ],
  };
  const base = createProject();
  return {
    ...base,
    scene: addLayer(addObject(base.scene, obj), createLayer({ id: 'L1', color: '#ff0000' })),
  };
}

// From the origin through every cut segment and back to the origin park.
function cutTravelMm(prepared: ReturnType<typeof prepareOutput>): number {
  if (!prepared.ok) throw new Error('expected prepared output');
  let cursor = { x: 0, y: 0 };
  let total = 0;
  for (const group of prepared.job.groups) {
    if (group.kind !== 'cut') continue;
    for (const segment of group.segments) {
      const first = segment.polyline[0];
      const last = segment.polyline.at(-1);
      if (first === undefined || last === undefined) continue;
      total += Math.hypot(first.x - cursor.x, first.y - cursor.y);
      cursor = last;
    }
  }
  return total + Math.hypot(cursor.x, cursor.y);
}

function firstCutSegmentStart(prepared: ReturnType<typeof prepareOutput>): {
  x: number;
  y: number;
} {
  if (!prepared.ok) throw new Error('expected prepared output');
  const group = prepared.job.groups[0];
  if (group?.kind !== 'cut') throw new Error('expected first group to be a cut group');
  const first = group.segments[0]?.polyline[0];
  if (first === undefined) throw new Error('expected first cut segment');
  return first;
}
