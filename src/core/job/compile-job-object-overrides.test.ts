import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { createLayer, IDENTITY_TRANSFORM, type SceneObject } from '../scene';
import { compileJob } from './compile-job';
import type { CutGroup, FillGroup } from './job';

function closedSquare(id: string, x: number): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: 0, maxX: x + 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x, y: 0 },
              { x: x + 10, y: 0 },
              { x: x + 10, y: 10 },
              { x, y: 10 },
            ],
          },
        ],
      },
    ],
  };
}

describe('compileJob object operation overrides', () => {
  it('overrides shared layer operation settings without changing same-color artwork', () => {
    const layer = {
      ...createLayer({ id: 'L1', color: '#000000' }),
      mode: 'line' as const,
      hatchSpacingMm: 1,
    };
    const filled = {
      ...closedSquare('filled', 20),
      operationOverride: { mode: 'fill' as const, hatchSpacingMm: 1 },
    };

    const job = compileJob(
      { objects: [closedSquare('outline', 0), filled], layers: [layer] },
      DEFAULT_DEVICE_PROFILE,
    );

    expect(job.groups.map((group) => group.kind)).toEqual(['cut', 'fill']);
    expect((job.groups[0] as CutGroup).segments[0]?.polyline).toHaveLength(4);
    expect((job.groups[1] as FillGroup).segments.length).toBeGreaterThan(1);
  });

  it('compiles a traced object Follow Shape override as an offset-fill group', () => {
    const layer = {
      ...createLayer({ id: 'L1', color: '#000000' }),
      mode: 'line' as const,
      fillStyle: 'scanline' as const,
      hatchSpacingMm: 1,
    };
    const square = closedSquare('trace', 0);
    if (square.kind !== 'imported-svg') throw new Error('expected imported svg fixture');
    const traced: SceneObject = {
      kind: 'traced-image',
      id: 'trace',
      source: 'wreath.png',
      traceMode: 'filled-contours',
      bounds: square.bounds,
      transform: IDENTITY_TRANSFORM,
      paths: square.paths,
      operationOverride: { mode: 'fill' as const, fillStyle: 'offset' as const },
    };

    const job = compileJob({ objects: [traced], layers: [layer] }, DEFAULT_DEVICE_PROFILE);

    expect(job.groups).toHaveLength(1);
    expect(job.groups[0]?.kind).toBe('fill');
    expect((job.groups[0] as FillGroup).fillStyle).toBe('offset');
    expect((job.groups[0] as FillGroup).segments.length).toBeGreaterThan(0);
  });
});
