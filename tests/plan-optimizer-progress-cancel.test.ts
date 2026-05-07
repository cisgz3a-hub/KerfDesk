/**
 * @copyright (c) 2025 LaserForge. All rights reserved.
 */
import { strict as assert } from 'node:assert';
import { createEmptyJob, flatPathFromPoints, type Operation, type ResolvedLaserSettings } from '../src/core/job/Job';
import { optimizePlan, type OptimizePlanProgress } from '../src/core/plan/PlanOptimizer';
import { emptyAABB } from '../src/core/types';

function settings(): ResolvedLaserSettings {
  return {
    powerMin: 0,
    powerMax: 80,
    speed: 1200,
    passes: 1,
    zStepPerPass: 0,
    fillInterval: 0,
    fillAngle: 0,
    fillMode: 'line',
    fillBiDirectional: false,
    overscanning: 0,
    overcut: 0,
    leadIn: 0,
    tabCount: 0,
    tabWidth: 0,
    insideFirst: false,
    airAssist: false,
    accelAwarePower: false,
    maxAccelMmPerS2: 500,
    minPowerRatioAccel: 0.2,
    scanningOffsets: [],
  };
}

function operation(index: number): Operation {
  const path = flatPathFromPoints([
    { x: index * 10, y: 0 },
    { x: index * 10 + 5, y: 0 },
  ], false, `obj-${index}`);
  return {
    id: `op-${index}`,
    layerId: `layer-${index}`,
    layerName: `Layer ${index}`,
    layerColor: '#ff00aa',
    order: index,
    type: 'cut',
    settings: settings(),
    geometry: { type: 'vector', paths: [path] },
    bounds: { ...path.bounds },
  };
}

function jobWithOperations(count: number) {
  const job = createEmptyJob('T2-17-plan-progress', 'test-project');
  job.operations = Array.from({ length: count }, (_, i) => operation(i));
  job.bounds = count > 0 ? { minX: 0, minY: 0, maxX: count * 10, maxY: 0 } : emptyAABB();
  return job;
}

const progressEvents: OptimizePlanProgress[] = [];
const plan = optimizePlan(jobWithOperations(3), {
  onProgress: event => progressEvents.push(event),
});

assert.equal(plan.operations.length, 3);
assert.ok(progressEvents.length >= 4, `expected start + per-operation progress events, got ${progressEvents.length}`);
assert.deepEqual(progressEvents.map(e => e.fraction), [0, 1 / 3, 2 / 3, 1]);
assert.deepEqual(progressEvents.map(e => e.operationCount), [3, 3, 3, 3]);
assert.deepEqual(progressEvents.map(e => e.operationIndex), [0, 1, 2, 3]);

const ac = new AbortController();
let threwAbort = false;
assert.throws(
  () => optimizePlan(jobWithOperations(4), {
    signal: ac.signal,
    onProgress: event => {
      if (event.operationIndex === 1) ac.abort();
    },
  }),
  (err: unknown) => {
    threwAbort = err instanceof DOMException && err.name === 'AbortError';
    return threwAbort;
  },
);
assert.equal(threwAbort, true);
