import { describe, expect, it } from 'vitest';
import type { Job, RasterGroup } from '../job';
import {
  MAX_COMPILED_MOTION_SEGMENTS,
  measureCompiledWork,
  runCompiledWorkPreflight,
} from './compiled-work';

describe('compiled work preflight', () => {
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

  it('blocks measured raster output expansion even when its source grid is tiny', () => {
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
