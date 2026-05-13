/**
 * T1-236: core inline ID generators should route through generateId().
 *
 * The old per-module `Date.now() + Math.random()` patterns ignored
 * LASERFORGE_DETERMINISTIC_IDS. These checks keep user-facing prefixes while
 * proving the variable suffix comes from the shared deterministic-aware helper.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { createBlankProfile } from '../src/core/devices/DeviceProfile';
import { createJobLog } from '../src/core/job/JobLog';
import { createReplay } from '../src/core/replay/JobReplay';
import { createLayer } from '../src/core/scene/Layer';
import { createScene } from '../src/core/scene/Scene';
import { createRect } from '../src/core/scene/SceneObject';
import { duplicateObjects } from '../src/core/scene/SceneOps';
import { resetDeterministicCounter } from '../src/core/types';
import { createUserMaterialFromLayer } from '../src/core/materials/MaterialPresets';
import { buildUserSavedPresetFromLayer } from '../src/core/materials/MaterialSettingConfidence';

function enableDeterministicIds(): void {
  process.env.LASERFORGE_DETERMINISTIC_IDS = '1';
  (globalThis as { __LF_DETERMINISTIC_IDS__?: boolean }).__LF_DETERMINISTIC_IDS__ = false;
  resetDeterministicCounter();
}

function clearDeterministicIds(): void {
  delete process.env.LASERFORGE_DETERMINISTIC_IDS;
  (globalThis as { __LF_DETERMINISTIC_IDS__?: boolean }).__LF_DETERMINISTIC_IDS__ = false;
  resetDeterministicCounter();
}

test('core factory IDs keep prefixes while using deterministic generateId suffixes', () => {
  enableDeterministicIds();
  assert.equal(createBlankProfile('Profile').id, 'dev_det-000001');

  enableDeterministicIds();
  assert.equal(
    createJobLog('Project', 10, '1m', [], 'idle', { x: 0, y: 0 }).id,
    'job_det-000001',
  );

  enableDeterministicIds();
  assert.equal(
    createReplay('Replay', 10, { layers: [], material: null, machineType: null }, null).id,
    'replay_det-000001',
  );

  enableDeterministicIds();
  assert.equal(
    createUserMaterialFromLayer(
      'Birch',
      'wood',
      3,
      'diode',
      '10W',
      { power: 80, speed: 200, passes: 1 },
      { power: 25, speed: 1200, passes: 1 },
    ).id,
    'user_mat_det-000001',
  );

  clearDeterministicIds();
});

test('preset and clone helpers use generateId fallbacks without dropping explicit IDs', () => {
  const layer = createLayer(0, 'engrave', 'Engrave');

  enableDeterministicIds();
  assert.equal(
    buildUserSavedPresetFromLayer(layer, {
      name: 'Layer preset',
      material: 'birch',
      thickness: '3mm',
      laserWattage: '10W',
    }).id,
    'preset-user-det-000001',
  );

  enableDeterministicIds();
  assert.equal(
    buildUserSavedPresetFromLayer(layer, {
      id: 'preset-user-explicit',
      name: 'Layer preset',
      material: 'birch',
      thickness: '3mm',
      laserWattage: '10W',
    }).id,
    'preset-user-explicit',
  );

  enableDeterministicIds();
  assert.equal(
    buildUserSavedPresetFromLayer(layer, {
      name: 'Layer preset',
      material: 'birch',
      thickness: '3mm',
      laserWattage: '10W',
      nowMs: 42.8,
    }).id,
    'preset-user-42',
  );

  let scene = createScene();
  const rect = { ...createRect(scene.activeLayerId, 0, 0, 10, 10), id: 'rect-a' };
  scene = { ...scene, objects: [rect] };
  enableDeterministicIds();
  const duplicated = duplicateObjects(scene, new Set(['rect-a']));
  assert.equal(duplicated.objects.at(-1)?.id, 'rect-a-copy-det-000001');

  clearDeterministicIds();
});

test('source no longer contains ad hoc Date.now plus Math.random ID formulas', () => {
  const files = [
    'src/core/devices/DeviceProfile.ts',
    'src/core/job/JobLog.ts',
    'src/core/replay/JobReplay.ts',
    'src/core/materials/MaterialPresets.ts',
    'src/core/materials/CalibrationAnalyzer.ts',
    'src/core/materials/MaterialLibrary.ts',
    'src/core/materials/MaterialSettingConfidence.ts',
    'src/core/scene/SceneOps.ts',
  ];

  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /Date\.now\(\).*Math\.random\(\)/s, file);
    assert.match(src, /generateId\(\)/, `${file} routes an ID through generateId()`);
  }
});
