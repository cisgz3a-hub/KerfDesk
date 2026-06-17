import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createLayer, IDENTITY_TRANSFORM, type Scene, type TracedImage } from '../scene';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { fillHatchingWithMetadata } from './fill-hatching';
import { compileJob } from './compile-job';

vi.mock('./fill-hatching', () => ({
  fillHatchingWithMetadata: vi.fn(() => [
    {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      closed: false,
      reverse: false,
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
    vi.mocked(fillHatchingWithMetadata).mockClear();
  });

  it('reuses fill hatches across unchanged estimates', () => {
    const scene = tracedFillScene();

    compileJob(scene, DEFAULT_DEVICE_PROFILE);
    compileJob(scene, DEFAULT_DEVICE_PROFILE);

    expect(fillHatchingWithMetadata).toHaveBeenCalledTimes(1);
  });

  it('passes fillBidirectional to the hatcher and re-hatches when it flips (ADR-038)', () => {
    const base = tracedFillScene();
    const uni: Scene = {
      ...base,
      layers: base.layers.map((l) => ({ ...l, fillBidirectional: false })),
    };

    compileJob(base, DEFAULT_DEVICE_PROFILE); // bidirectional: true (default)
    compileJob(uni, DEFAULT_DEVICE_PROFILE); // bidirectional: false

    // The compile path threads the layer flag into fillHatching...
    expect(fillHatchingWithMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ bidirectional: false }),
    );
    // ...and flipping it is not a cache hit — both directions are computed
    // (the flag is part of both fill cache keys, so a stale snake path can't
    // be reused for a unidirectional layer).
    expect(fillHatchingWithMetadata).toHaveBeenCalledTimes(2);
  });

  it('computes and caches both hatch angles when cross-hatch is enabled', () => {
    const base = tracedFillScene();
    const cross: Scene = {
      ...base,
      layers: base.layers.map((l) => ({ ...l, fillCrossHatch: true })),
    };

    compileJob(cross, DEFAULT_DEVICE_PROFILE);
    compileJob(cross, DEFAULT_DEVICE_PROFILE);

    expect(fillHatchingWithMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ hatchAngleDeg: 0, bidirectional: true }),
    );
    expect(fillHatchingWithMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ hatchAngleDeg: 90, bidirectional: true }),
    );
    expect(fillHatchingWithMetadata).toHaveBeenCalledTimes(2);
  });
});
