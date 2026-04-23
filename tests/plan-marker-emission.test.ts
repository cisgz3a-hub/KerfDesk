/**
 * MarkerMove emission in optimizePlan (vector / fill / raster).
 * Run: npx tsx tests/plan-marker-emission.test.ts
 */

import {
  type Job,
  type Operation,
  type ResolvedLaserSettings,
  type ProcessedBitmap,
  type FlatPath,
  createEmptyJob,
} from '../src/core/job/Job';
import { optimizePlan } from '../src/core/plan/PlanOptimizer';
import { generateId } from '../src/core/types';
import { EMPTY_OFFSET_TABLE } from '../src/core/plan/ScanningOffset';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

const baseSettings: ResolvedLaserSettings = {
  powerMin: 0,
  powerMax: 80,
  speed: 1000,
  passes: 1,
  zStepPerPass: 0,
  fillInterval: 0.1,
  fillAngle: 0,
  fillMode: 'line',
  fillBiDirectional: true,
  overscanning: 0,
  overcut: 0,
  leadIn: 0,
  tabCount: 0,
  tabWidth: 0,
  insideFirst: false,
  airAssist: false,
  accelAwarePower: false,
  maxAccelMmPerS2: 500,
  minPowerRatioAccel: 0.1,
  scanningOffsets: EMPTY_OFFSET_TABLE,
};

function flatPath(id: string, x: number, y: number, w: number, h: number): FlatPath {
  const coords = new Float64Array([x, y, x + w, y, x + w, y + h, x, y + h]);
  return {
    id,
    coords,
    closed: true,
    direction: 'ccw',
    bounds: { minX: x, minY: y, maxX: x + w, maxY: y + h },
    parentId: null,
    powerScale: 1,
  };
}

console.log('\n=== plan-marker-emission: vector (3 FlatPaths) ===');
{
  const job = createEmptyJob('m1', 't');
  const paths = [flatPath('obj-a', 0, 0, 10, 10), flatPath('obj-b', 20, 0, 10, 10), flatPath('obj-c', 40, 0, 10, 10)];
  const op: Operation = {
    id: generateId(),
    layerId: 'L1',
    layerName: 'Cut',
    layerColor: '#f00',
    order: 0,
    type: 'cut',
    settings: baseSettings,
    geometry: { type: 'vector', paths },
    bounds: { minX: 0, minY: 0, maxX: 50, maxY: 10 },
  };
  job.operations.push(op);
  const plan = optimizePlan(job);
  const moves = plan.operations[0].moves;
  const markers = moves.filter(m => m.type === 'marker');
  assert(markers.length === 3, `3 MarkerMoves (got ${markers.length})`);
  assert(
    markers[0].type === 'marker' && markers[0].sourceObjectIds.join(',') === 'obj-a',
    'marker 0 = obj-a',
  );
  assert(
    markers[1].type === 'marker' && markers[1].sourceObjectIds.join(',') === 'obj-b',
    'marker 1 = obj-b',
  );
  assert(
    markers[2].type === 'marker' && markers[2].sourceObjectIds.join(',') === 'obj-c',
    'marker 2 = obj-c',
  );
  const firstRapidIdx = moves.findIndex(m => m.type === 'rapid');
  const firstMarkerIdx = moves.findIndex(m => m.type === 'marker');
  assert(firstMarkerIdx >= 0 && firstRapidIdx === firstMarkerIdx + 1, 'first rapid follows first marker');
}

console.log('\n=== plan-marker-emission: fill (2 paths, 1 marker) ===');
{
  const job = createEmptyJob('m2', 't');
  const paths = [flatPath('eng-a', 0, 0, 5, 5), flatPath('eng-b', 10, 0, 5, 5)];
  const op: Operation = {
    id: generateId(),
    layerId: 'L1',
    layerName: 'Engrave',
    layerColor: '#0ff',
    order: 0,
    type: 'engrave',
    settings: baseSettings,
    geometry: { type: 'fill', paths },
    bounds: { minX: 0, minY: 0, maxX: 15, maxY: 5 },
  };
  job.operations.push(op);
  const plan = optimizePlan(job);
  const moves = plan.operations[0].moves;
  const markers = moves.filter(m => m.type === 'marker');
  assert(markers.length === 1, `1 MarkerMove for fill (got ${markers.length})`);
  const m0 = markers[0];
  assert(m0.type === 'marker', 'marker type');
  const ids = [...m0.sourceObjectIds].sort().join(',');
  assert(ids === 'eng-a,eng-b', `deduped ids eng-a,eng-b (got ${ids})`);
}

console.log('\n=== plan-marker-emission: raster ===');
{
  const job = createEmptyJob('m3', 't');
  const bitmap: ProcessedBitmap = {
    width: 2,
    height: 2,
    dpi: 254,
    sourceObjectId: 'img-1',
    mode: '1bit',
    data: new Uint8Array([1, 1, 1, 1]),
    physicalWidth: 2,
    physicalHeight: 2,
    position: { x: 0, y: 0 },
    pipeline: {
      brightness: 0,
      contrast: 0,
      gamma: 1,
      ditheringMode: 'threshold',
      inverted: false,
    },
  };
  const op: Operation = {
    id: generateId(),
    layerId: 'L1',
    layerName: 'Img',
    layerColor: '#888',
    order: 0,
    type: 'raster',
    settings: baseSettings,
    geometry: { type: 'raster', bitmap },
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
  };
  job.operations.push(op);
  const plan = optimizePlan(job);
  const moves = plan.operations[0].moves;
  const markers = moves.filter(m => m.type === 'marker');
  assert(markers.length === 1, `1 MarkerMove for raster (got ${markers.length})`);
  const m0 = markers[0];
  assert(
    m0.type === 'marker' && m0.sourceObjectIds.length === 1 && m0.sourceObjectIds[0] === 'img-1',
    'raster marker ids = img-1',
  );
}

console.log(`\nplan-marker-emission: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
