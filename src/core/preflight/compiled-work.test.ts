import { describe, expect, it } from 'vitest';
import type { Job, RasterGroup } from '../job';
import { cutSegmentsForPass, finalPassCutSegments } from '../job/cut-pass-segments';
import {
  MAX_COMPILED_MOTION_SEGMENTS,
  measureCompiledWork,
  runCompiledWorkPreflight,
} from './compiled-work';

describe('compiled work preflight', () => {
  it('counts the final-pass burn using the same paths the emitter walks', () => {
    const points = Array.from({ length: 6 }, (_, x) => ({ x, y: 0 }));
    const group = {
      kind: 'cut' as const,
      layerId: 'L',
      color: '#000000',
      power: 50,
      speed: 1000,
      passes: 3,
      airAssist: false,
      finalPassOvercutMm: 2,
      segments: [
        { closed: false, polyline: points.slice(0, 2), finalPassBurn: { polyline: points } },
      ],
    };
    const final = finalPassCutSegments(group);
    const emitted = Array.from({ length: group.passes }, (_, pass) =>
      cutSegmentsForPass(group, final, pass, group.passes).reduce(
        (sum, segment) => sum + segment.polyline.length - 1,
        0,
      ),
    ).reduce((sum, count) => sum + count, 0);
    const measured = measureCompiledWork({ groups: [group] });
    expect(emitted).toBe(7);
    expect(measured.motionSegments).toBe(emitted);
    expect(measured.estimatedOutputBytes).toBe(emitted * 48);
  });

  it('measures actual vector segments instead of source contour count', () => {
    const segment = {
      polyline: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      closed: false,
    };
    const job: Job = {
      groups: [
        {
          kind: 'cut',
          layerId: 'L1',
          color: '#000000',
          power: 50,
          speed: 1000,
          passes: 2,
          airAssist: false,
          segments: [segment, segment],
        },
      ],
    };

    expect(measureCompiledWork(job).motionSegments).toBe(4);
    expect(runCompiledWorkPreflight(job).ok).toBe(true);
  });

  it('flags measured raster output expansion as an advisory even when its source grid is tiny', () => {
    const raster: RasterGroup = {
      kind: 'raster',
      layerId: 'image',
      color: '#808080',
      power: 50,
      speed: 1000,
      passes: 1_000_000,
      airAssist: false,
      sValues: new Uint16Array(0),
      rowProvider: () => new Uint16Array([100, 0, 100, 0]),
      pixelWidth: 4,
      pixelHeight: 1,
      bounds: { minX: 0, minY: 0, maxX: 4, maxY: 1 },
      overscanMm: 0,
      dotWidthCorrectionMm: 0,
    };

    const result = runCompiledWorkPreflight({ groups: [raster] });
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'compiled-output-budget-exceeded' }),
    );
    expect(measureCompiledWork({ groups: [raster] }).motionSegments).toBeGreaterThan(
      MAX_COMPILED_MOTION_SEGMENTS,
    );
  });
});
