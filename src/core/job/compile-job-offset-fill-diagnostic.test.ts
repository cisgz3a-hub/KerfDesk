import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { createLayer, IDENTITY_TRANSFORM, type Scene, type SceneObject } from '../scene';

// Fail the offset engine the way clipper2 does on pathological geometry. The
// checked variant surfaces it as a Result, which is what lets compileJob report
// the loss instead of emitting a job that is quietly missing a fill.
const offsetCheckedMock = vi.hoisted(() => vi.fn());

vi.mock('../geometry/kerf-offset', () => ({
  offsetClosedPolylinesForKerf: () => [],
  offsetClosedPolylinesForKerfChecked: offsetCheckedMock,
}));

const { compileJob } = await import('./compile-job');

const COLOR = '#ff0000';

function offsetFillScene(): Scene {
  const layer = {
    ...createLayer({ id: 'offset-fill-layer', name: 'Offset Fill', color: COLOR }),
    mode: 'fill' as const,
    fillStyle: 'offset' as const,
    output: true,
    visible: true,
    hatchSpacingMm: 1,
  };
  const square: SceneObject = {
    kind: 'imported-svg',
    id: 'square',
    source: 'square.svg',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: COLOR,
        polylines: [
          {
            points: [
              { x: 0, y: 0 },
              { x: 20, y: 0 },
              { x: 20, y: 20 },
              { x: 0, y: 20 },
            ],
            closed: true,
          },
        ],
      },
    ],
  };
  return { layers: [layer], objects: [square] };
}

describe('compileJob offset-fill diagnostics', () => {
  it('reports the failed layer by name even though the fill left no group behind', () => {
    offsetCheckedMock.mockImplementation(() => ({
      kind: 'error',
      error: { kind: 'operation-failed', message: 'clipper2: pathological geometry' },
    }));

    const job = compileJob(offsetFillScene(), DEFAULT_DEVICE_PROFILE);

    // This is the case the old code lost entirely: no segments means no group,
    // so without the diagnostic the layer vanished with nothing surfaced.
    expect(job.groups.filter((group) => group.kind === 'fill')).toEqual([]);
    expect(job.diagnostics).toEqual([{ kind: 'offset-fill-failed', layerName: 'Offset Fill' }]);
  });

  it('reports the defensive pass limit while keeping the contours already generated', () => {
    offsetCheckedMock.mockImplementation((polylines) => ({
      kind: 'ok',
      value: polylines,
    }));

    const job = compileJob(offsetFillScene(), DEFAULT_DEVICE_PROFILE);

    expect(job.groups.filter((group) => group.kind === 'fill')).not.toEqual([]);
    expect(job.diagnostics).toEqual([
      { kind: 'offset-fill-pass-limit', layerName: 'Offset Fill', passLimit: 22 },
    ]);
  });

  it('leaves diagnostics off the job entirely when the offset fill succeeds', () => {
    let calls = 0;
    offsetCheckedMock.mockImplementation(() => {
      calls += 1;
      return {
        kind: 'ok',
        value:
          calls === 1
            ? [
                {
                  points: [
                    { x: 5, y: 5 },
                    { x: 15, y: 5 },
                    { x: 15, y: 15 },
                    { x: 5, y: 15 },
                  ],
                  closed: true,
                },
              ]
            : [],
      };
    });

    const job = compileJob(offsetFillScene(), DEFAULT_DEVICE_PROFILE);

    expect(job.diagnostics).toBeUndefined();
  });
});
