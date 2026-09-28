// A Fill with an angle change per pass (ADR-492) hatches each pass at its own
// angle as its own group; without one it compiles exactly as before.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { createLayer, IDENTITY_TRANSFORM, type Layer, type TracedImage } from '../scene';
import { compileJob } from './compile-job';
import type { FillGroup, Job } from './job';

function square(): TracedImage {
  return {
    kind: 'traced-image',
    id: 'trace-1',
    source: 'trace.png',
    traceMode: 'filled-contours',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, x: 20, y: 20 },
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
              { x: 0, y: 10 },
              { x: 0, y: 0 },
            ],
          },
        ],
      },
    ],
  };
}

function fillLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    ...createLayer({ id: 'fill', color: '#000000', mode: 'fill' as const }),
    hatchSpacingMm: 1,
    hatchAngleDeg: 0,
    ...overrides,
  };
}

function compile(overrides: Partial<Layer> = {}): Job {
  return compileJob(
    { objects: [square()], layers: [fillLayer(overrides)] },
    DEFAULT_DEVICE_PROFILE,
  );
}

function fillGroups(job: Job): FillGroup[] {
  return job.groups.filter((group): group is FillGroup => group.kind === 'fill');
}

// Direction of a group's hatch lines, in degrees folded into [0, 180).
function hatchDirections(group: FillGroup): number[] {
  const directions = group.segments.flatMap((segment) => {
    const [a, b] = segment.polyline;
    if (a === undefined || b === undefined) return [];
    const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    return [Math.round(((deg % 180) + 180) % 180) % 180];
  });
  return [...new Set(directions)];
}

describe('fill angle change per pass (ADR-492)', () => {
  it('compiles one group with every pass when the step does not apply', () => {
    const reference = compile({ passes: 3 });
    expect(fillGroups(reference)).toHaveLength(1);
    expect(fillGroups(reference)[0]?.passes).toBe(3);
    expect(compile({ passes: 3, passAngleStepDeg: 0 })).toEqual(reference);
    expect(compile({ passes: 3, passAngleStepDeg: 180 })).toEqual(reference);
    expect(compile({ passes: 1, passAngleStepDeg: 45 }).groups).toEqual(
      compile({ passes: 1 }).groups,
    );
  });

  it('hatches each pass at the base angle plus its steps', () => {
    const groups = fillGroups(compile({ passes: 3, hatchAngleDeg: 0, passAngleStepDeg: 90 }));
    expect(groups.map((group) => group.passes)).toEqual([1, 1, 1]);
    expect(groups.map(hatchDirections)).toEqual([[0], [90], [0]]);
  });

  it('keeps offset fills on their rings, which have no angle', () => {
    const groups = fillGroups(compile({ passes: 2, fillStyle: 'offset', passAngleStepDeg: 90 }));
    expect(groups).toHaveLength(1);
    expect(groups[0]?.passes).toBe(2);
  });
});
