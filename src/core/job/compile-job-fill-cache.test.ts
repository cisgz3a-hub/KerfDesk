import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createLayer, IDENTITY_TRANSFORM, type Scene, type TracedImage } from '../scene';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { fillHatching } from './fill-hatching';
import { compileJob } from './compile-job';

vi.mock('./fill-hatching', () => ({
  fillHatching: vi.fn(() => [
    {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      closed: false,
    },
  ]),
}));

function tracedFillScene(): Scene {
  const traced: TracedImage = {
    kind: 'traced-image',
    id: 'trace-1',
    source: 'trace.png',
    traceMode: 'filled-contours',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
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
  return {
    layers: [
      { ...createLayer({ id: '#000000', color: '#000000', mode: 'fill' }), hatchSpacingMm: 1 },
    ],
    objects: [traced],
  };
}

describe('compileJob fill hatch cache', () => {
  beforeEach(() => {
    vi.mocked(fillHatching).mockClear();
  });

  it('reuses fill hatches across unchanged estimates', () => {
    const scene = tracedFillScene();

    compileJob(scene, DEFAULT_DEVICE_PROFILE);
    compileJob(scene, DEFAULT_DEVICE_PROFILE);

    expect(fillHatching).toHaveBeenCalledTimes(1);
  });
});
