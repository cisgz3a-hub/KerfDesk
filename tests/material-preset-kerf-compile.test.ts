/**
 * F45-10-004: Material preset kerf fields must affect compiled cut geometry.
 *
 * Run: npx tsx tests/material-preset-kerf-compile.test.ts
 */

import { compileJob } from '../src/core/job/JobCompiler';
import { createScene } from '../src/core/scene/Scene';
import { createLine, createRect } from '../src/core/scene/SceneObject';
import { createLayer, type Layer } from '../src/core/scene/Layer';
import type { FlatPath, Operation } from '../src/core/job/Job';
import type { MaterialPreset } from '../src/core/materials/MaterialPreset';
import { buildPresetSnapshot } from '../src/core/materials/MaterialPresetSnapshot';
import {
  initializeMaterialLibrary,
  resetMaterialLibraryForTest,
  savePreset,
} from '../src/core/materials/MaterialLibrary';
import { InMemoryStorageAdapter } from '../src/core/storage/InMemoryStorageAdapter';
import { setStorageForTest } from '../src/core/storage/storage';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function nearlyEqual(actual: number, expected: number, epsilon = 1e-6): boolean {
  return Math.abs(actual - expected) <= epsilon;
}

function assertNear(actual: number, expected: number, message: string): void {
  assert(nearlyEqual(actual, expected), `${message} (expected ${expected}, got ${actual})`);
}

function makePreset(kerf: number): MaterialPreset {
  return {
    id: 'preset-kerf-compile',
    name: 'Kerf Compile Preset',
    material: 'Plywood',
    thickness: '3mm',
    laserWattage: '10W',
    operations: {
      cut: { power: 80, speed: 200, passes: 1 },
    },
    kerf,
  };
}

function makeKerfLayer(preset: MaterialPreset): Layer {
  const layer = createLayer(0, 'cut', 'Kerf Cut');
  return {
    ...layer,
    settings: {
      ...layer.settings,
      materialPresetId: preset.id,
      materialPresetSnapshot: buildPresetSnapshot(preset),
    },
  };
}

function findOperation(job: ReturnType<typeof compileJob>): Operation {
  const op = job.operations.find(o => o.type === 'cut' && o.geometry.type === 'vector');
  if (!op || op.geometry.type !== 'vector') {
    throw new Error('Expected one vector cut operation');
  }
  return op;
}

function findPath(op: Operation, sourceId: string): FlatPath {
  if (op.geometry.type !== 'vector') throw new Error('Expected vector geometry');
  const path = op.geometry.paths.find(p => p.id === sourceId);
  if (!path) throw new Error(`Expected path for ${sourceId}`);
  return path;
}

async function setupMaterialLibrary(): Promise<void> {
  setStorageForTest(new InMemoryStorageAdapter());
  resetMaterialLibraryForTest();
  await initializeMaterialLibrary();
}

async function run(): Promise<void> {
  console.log('\n=== F45-10-004 material preset kerf compile ===\n');

  await setupMaterialLibrary();

  const savedPreset = makePreset(1);
  savePreset(savedPreset);

  const scene = createScene(100, 100, 'Material preset kerf compile');
  scene.compileOptions = { optimizeOrder: false };
  const layer = makeKerfLayer(savedPreset);
  scene.layers = [layer];
  scene.activeLayerId = layer.id;

  const square = createRect(layer.id, 10, 10, 10, 10, 'Closed square');
  const openLine = createLine(layer.id, 30, 40, 40, 40, 'Open line');
  scene.objects = [square, openLine];

  // Simulate a later preset edit: compile must use the saved layer snapshot
  // instead of silently changing output to the current library entry.
  savePreset(makePreset(4));

  const job = compileJob(scene);
  const op = findOperation(job);
  const squarePath = findPath(op, square.id);
  const linePath = findPath(op, openLine.id);

  assertNear(squarePath.bounds.minX, 9, 'closed square minX expands by snapshot kerf');
  assertNear(squarePath.bounds.minY, 9, 'closed square minY expands by snapshot kerf');
  assertNear(squarePath.bounds.maxX, 21, 'closed square maxX expands by snapshot kerf');
  assertNear(squarePath.bounds.maxY, 21, 'closed square maxY expands by snapshot kerf');

  assertNear(linePath.bounds.minX, 30, 'open line minX is not kerf-offset');
  assertNear(linePath.bounds.minY, 40, 'open line minY is not kerf-offset');
  assertNear(linePath.bounds.maxX, 40, 'open line maxX is not kerf-offset');
  assertNear(linePath.bounds.maxY, 40, 'open line maxY is not kerf-offset');

  assertNear(op.bounds.minX, 9, 'operation bounds include kerf-expanded closed path');
  assertNear(op.bounds.maxX, 40, 'operation bounds still include open path extent');

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  setStorageForTest(null);
  resetMaterialLibraryForTest();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((error: unknown) => {
  setStorageForTest(null);
  resetMaterialLibraryForTest();
  console.error(error);
  process.exit(1);
});
