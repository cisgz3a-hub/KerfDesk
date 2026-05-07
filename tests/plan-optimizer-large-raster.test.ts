/**
 * Guardrail: optimizePlan must handle large raster move sets without
 * spread-argument stack overflows.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateId } from '../src/core/types';
import { createEmptyJob, type Job, type Operation, type ResolvedLaserSettings } from '../src/core/job/Job';
import { optimizePlan } from '../src/core/plan/PlanOptimizer';

function makeRasterSettings(): ResolvedLaserSettings {
  return {
    powerMin: 0,
    powerMax: 80,
    speed: 3000,
    passes: 1,
    zStepPerPass: 0,
    fillInterval: 0.1,
    fillAngle: 0,
    fillMode: 'line',
    fillBiDirectional: true,
    overscanning: 2,
    overcut: 0,
    leadIn: 0,
    tabCount: 0,
    tabWidth: 5,
    insideFirst: true,
    airAssist: false,
    accelAwarePower: true,
    maxAccelMmPerS2: 1000,
    minPowerRatioAccel: 0.1,
    scanningOffsets: [],
  };
}

test('optimizePlan handles large raster without stack overflow', () => {
  const width = 1200;
  const height = 120;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Alternate on/off pixels to maximize segment count per scanline.
      data[y * width + x] = x % 2 === 0 ? 255 : 0;
    }
  }

  const job: Job = createEmptyJob('Large raster stress', 'test');
  const op: Operation = {
    id: generateId(),
    layerId: 'layer-raster',
    layerName: 'Raster',
    layerColor: '#ffffff',
    order: 0,
    type: 'raster',
    settings: makeRasterSettings(),
    geometry: {
      type: 'raster',
      bitmap: {
        width,
        height,
        dpi: 254,
        sourceObjectId: 'large-raster-object',
        mode: '1bit',
        data,
        physicalWidth: 120,
        physicalHeight: 12,
        position: { x: 0, y: 0 },
        pipeline: {
          brightness: 0,
          contrast: 0,
          gamma: 1,
          ditheringMode: 'none',
          inverted: false,
          imageMode: 'threshold',
          imageThreshold: 128,
        },
      },
    },
    bounds: { minX: 0, minY: 0, maxX: 120, maxY: 12 },
  };
  job.operations = [op];
  job.bounds = op.bounds;

  assert.doesNotThrow(() => {
    optimizePlan(job);
  });
});
