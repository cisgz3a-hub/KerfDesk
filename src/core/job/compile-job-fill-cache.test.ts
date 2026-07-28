import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createLayer, IDENTITY_TRANSFORM, type Scene, type TracedImage } from '../scene';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { grblStrategy } from '../output/grbl-strategy';
import { fillHatchingWithMetadata } from './fill-hatching';
import { compileJob } from './compile-job';

const CALIBRATED_OFFSET_MM = 0.0004;

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
      {
        ...createLayer({ id: '#000000', color: '#000000', mode: 'fill' }),
        hatchSpacingMm: 1,
        fillBidirectional: true,
      },
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

    compileJob(base, DEFAULT_DEVICE_PROFILE); // explicitly bidirectional
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

  it('retains a reverse hatch that becomes emittable after calibrated translation', () => {
    const scene = tracedFillScene();
    const layer = scene.layers[0];
    if (layer === undefined) throw new Error('Expected traced fill fixture layer');
    const device = {
      ...DEFAULT_DEVICE_PROFILE,
      scanningOffsets: [{ speedMmPerMin: layer.speed, offsetMm: CALIBRATED_OFFSET_MM }],
    };
    vi.mocked(fillHatchingWithMetadata).mockReturnValueOnce([
      {
        points: [
          { x: 10.0004, y: 0 },
          { x: 9.9996, y: 0 },
        ],
        closed: false,
        reverse: true,
      },
    ]);

    const job = compileJob(scene, device);
    const gcode = grblStrategy.emit(job, device);

    expect(job.groups).toHaveLength(1);
    expect(job.diagnostics).toBeUndefined();
    expect(gcode).toContain('G1 X9.999 Y0.000');
  });

  it('removes a generic fill group when every hatch collapses at emitted precision', () => {
    const scene = tracedFillScene();
    vi.mocked(fillHatchingWithMetadata).mockReturnValueOnce([
      {
        points: [
          { x: 10.0004, y: 0 },
          { x: 9.9996, y: 0 },
        ],
        closed: false,
        reverse: true,
      },
    ]);

    const job = compileJob(scene, DEFAULT_DEVICE_PROFILE);
    const gcode = grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);

    expect(job.groups).toEqual([]);
    expect(job.diagnostics).toEqual([
      { kind: 'fill-collapsed-at-precision', layerName: 'Operation' },
    ]);
    expect(gcode).not.toMatch(/^G1\b/m);
  });
});
