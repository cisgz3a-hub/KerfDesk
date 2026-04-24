/**
 * Structured preflight engine tests.
 * Run: node node_modules/tsx/dist/cli.mjs tests/preflight.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLayer } from '../src/core/scene/Layer';
import { createScene, type Scene } from '../src/core/scene/Scene';
import { createRect } from '../src/core/scene/SceneObject';
import { type DeviceProfile, createBlankProfile } from '../src/core/devices/DeviceProfile';
import {
  runPreflight,
  hasBlockingErrors,
  groupBySeverity,
  PREFLIGHT_CODES,
  type PreflightContext,
} from '../src/core/preflight/Preflight';

function makeProfile(overrides: Partial<DeviceProfile> = {}): DeviceProfile {
  return { ...createBlankProfile('Test'), bedWidth: 300, bedHeight: 300, ...overrides };
}

function makeScene(overrides: Partial<Scene> = {}): Scene {
  const s = createScene(300, 300, 'Preflight test');
  const baseLayer = s.layers[0];
  baseLayer.name = 'Layer 1';
  const rect = createRect(baseLayer.id, 10, 10, 40, 30, 'Rect');
  return {
    ...s,
    ...overrides,
    layers: overrides.layers ?? [baseLayer],
    objects: overrides.objects ?? [rect],
  };
}

function makeCtx(overrides: Partial<PreflightContext> = {}): PreflightContext {
  return {
    scene: makeScene(),
    profile: makeProfile(),
    optimizeOrderEnabled: true,
    preflightBedWidthMm: 300,
    preflightBedHeightMm: 300,
    ...overrides,
  };
}

test('empty scene triggers SCENE_EMPTY error', () => {
  const results = runPreflight(makeCtx({ scene: makeScene({ objects: [] }) }));
  assert.ok(results.some(r => r.code === PREFLIGHT_CODES.SCENE_EMPTY && r.severity === 'error'));
  assert.equal(hasBlockingErrors(results), true);
});

test('all layers hidden with objects triggers NO_VISIBLE_LAYERS', () => {
  const scene = makeScene();
  scene.layers[0].visible = false;
  const results = runPreflight(makeCtx({ scene }));
  assert.ok(results.some(r => r.code === PREFLIGHT_CODES.NO_VISIBLE_LAYERS));
});

test('object beyond bed width triggers OUT_OF_BOUNDS_MAX', () => {
  const scene = makeScene();
  scene.objects = [createRect(scene.layers[0].id, 280, 10, 40, 20)];
  const results = runPreflight(makeCtx({ scene }));
  assert.ok(results.some(r => r.code === PREFLIGHT_CODES.OUT_OF_BOUNDS_MAX && r.severity === 'error'));
});

test('object with negative coordinates triggers OUT_OF_BOUNDS_MIN', () => {
  const scene = makeScene();
  scene.objects = [createRect(scene.layers[0].id, -5, 10, 20, 20)];
  const results = runPreflight(makeCtx({ scene }));
  assert.ok(results.some(r => r.code === PREFLIGHT_CODES.OUT_OF_BOUNDS_MIN));
});

test('missing bed size triggers MISSING_BED_SIZE', () => {
  const results = runPreflight(makeCtx({ profile: makeProfile({ bedWidth: 0 }) }));
  assert.ok(results.some(r => r.code === PREFLIGHT_CODES.MISSING_BED_SIZE));
});

test('zero power layer triggers LAYER_POWER_ZERO', () => {
  const scene = makeScene();
  scene.layers[0].settings.power.max = 0;
  const results = runPreflight(makeCtx({ scene }));
  assert.ok(results.some(r => r.code === PREFLIGHT_CODES.LAYER_POWER_ZERO));
});

test('speed above max triggers LAYER_SPEED_HIGH warning', () => {
  const scene = makeScene();
  scene.layers[0].settings.speed = 20000;
  const results = runPreflight(makeCtx({ scene, profile: makeProfile({ maxRateX: 10000, maxRateY: 10000 }) }));
  assert.ok(results.some(r => r.code === PREFLIGHT_CODES.LAYER_SPEED_HIGH && r.severity === 'warning'));
});

test('homing enabled without $H triggers HOMING_ENABLED_NO_H', () => {
  const results = runPreflight(
    makeCtx({
      profile: makeProfile({ homingEnabled: true }),
      gcodeHeaderPreview: 'G21\nG90',
    }),
  );
  assert.ok(results.some(r => r.code === PREFLIGHT_CODES.HOMING_ENABLED_NO_H));
});

test('accel-aware power without accel params triggers warning', () => {
  const results = runPreflight(
    makeCtx({
      profile: makeProfile({ accelAwarePower: true, maxAccelMmPerS2: 0, maxAccelX: 0, maxAccelY: 0 }),
    }),
  );
  assert.ok(results.some(r => r.code === PREFLIGHT_CODES.ACCEL_AWARE_NO_ACCEL_PARAM));
});

test('long estimated job triggers LONG_JOB warning', () => {
  const results = runPreflight(makeCtx({ estimatedTimeSeconds: 7200 }));
  assert.ok(results.some(r => r.code === PREFLIGHT_CODES.LONG_JOB && r.severity === 'warning'));
});

test('profile bed mismatch to live machine triggers BED_SIZE_MISMATCH', () => {
  const results = runPreflight(
    makeCtx({
      profile: makeProfile({ bedWidth: 300, bedHeight: 300 }),
      liveMachineInfo: { bedWidthMm: 410, bedHeightMm: 400 },
    }),
  );
  assert.ok(results.some(r => r.code === PREFLIGHT_CODES.BED_SIZE_MISMATCH));
});

test('non-monotonic calibration triggers CALIBRATION_NOT_MONOTONIC', () => {
  const scene = makeScene();
  scene.layers[0].settings.mode = 'image';
  const results = runPreflight(
    makeCtx({
      scene,
      profile: makeProfile({
        scanningOffsets: [
          { speedMmPerMin: 5000, offsetMm: 0.2 },
          { speedMmPerMin: 3000, offsetMm: 0.1 },
        ],
      }),
    }),
  );
  assert.ok(results.some(r => r.code === PREFLIGHT_CODES.CALIBRATION_NOT_MONOTONIC));
});

test('clean scene returns no errors', () => {
  const results = runPreflight(makeCtx());
  assert.equal(results.some(r => r.severity === 'error'), false);
});

test('connected with missing machineStatus triggers MACHINE_DISCONNECTED', () => {
  const results = runPreflight(
    makeCtx({ connectedToMachine: true, machineStatus: null }),
  );
  assert.ok(
    results.some(
      r =>
        r.code === PREFLIGHT_CODES.MACHINE_DISCONNECTED &&
        r.severity === 'error' &&
        r.message === 'Not connected to a machine',
    ),
  );
});

test('hasBlockingErrors true iff error exists', () => {
  const clean = runPreflight(makeCtx());
  const withError = runPreflight(makeCtx({ scene: makeScene({ objects: [] }) }));
  assert.equal(hasBlockingErrors(clean), false);
  assert.equal(hasBlockingErrors(withError), true);
});

test('groupBySeverity includes all severity keys with counts', () => {
  const results = runPreflight(makeCtx({ scene: makeScene({ objects: [] }) }));
  const grouped = groupBySeverity(results);
  assert.ok(Array.isArray(grouped.error));
  assert.ok(Array.isArray(grouped.warning));
  assert.ok(Array.isArray(grouped.info));
  assert.equal(grouped.error.length >= 1, true);
});

test('results are sorted error-first then warning then info', () => {
  const scene = makeScene();
  scene.layers[0].settings.power.max = 0; // error
  scene.layers[0].settings.speed = 50; // warning
  const layer2 = createLayer(1, 'cut', 'Layer 2');
  layer2.visible = true;
  const results = runPreflight(
    makeCtx({
      scene: { ...scene, layers: [scene.layers[0], layer2] }, // layer2 empty -> warning
      optimizeOrderEnabled: false,
    }),
  );
  const severities = results.map(r => r.severity);
  const firstWarning = severities.indexOf('warning');
  const firstInfo = severities.indexOf('info');
  if (firstWarning >= 0) {
    assert.equal(severities.slice(0, firstWarning).every(s => s === 'error'), true);
  }
  if (firstInfo >= 0 && firstWarning >= 0) {
    assert.equal(severities.slice(firstWarning, firstInfo).every(s => s === 'warning'), true);
  }
});
