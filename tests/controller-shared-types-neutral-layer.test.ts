/**
 * T1-230: controller-owned shared types must not live in the app layer.
 *
 * The controller layer is below `src/app`; even type-only imports from app to
 * controllers blur the dependency direction and were filed as audit F-006.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const controllerFiles = [
  'src/controllers/ControllerInterface.ts',
  'src/controllers/ControllerSafetyOps.ts',
  'src/controllers/grbl/ForceSafeState.ts',
  'src/controllers/grbl/GrblController.ts',
];

test('controller files do not import shared safety types from src/app', () => {
  for (const file of controllerFiles) {
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /from ['"].*app\/SafetyActionResult['"]/, file);
    assert.doesNotMatch(src, /from ['"].*app\/MachineSafetyState['"]/, file);
  }
});

test('shared safety result and controller status types live in src/controllers', () => {
  assert.equal(existsSync('src/controllers/SafetyActionResult.ts'), true);
  assert.equal(existsSync('src/controllers/ControllerStatus.ts'), true);

  const safety = readFileSync('src/controllers/SafetyActionResult.ts', 'utf8');
  const status = readFileSync('src/controllers/ControllerStatus.ts', 'utf8');

  assert.match(safety, /T1-230/);
  assert.match(safety, /export interface SafetyActionResult/);
  assert.match(status, /T1-230/);
  assert.match(status, /export type ControllerStatus/);
});

test('app-level files are compatibility re-export wrappers for old imports', () => {
  const safetyWrapper = readFileSync('src/app/SafetyActionResult.ts', 'utf8');
  const machineSafety = readFileSync('src/app/MachineSafetyState.ts', 'utf8');

  assert.match(safetyWrapper, /export \* from ['"]\.\.\/controllers\/SafetyActionResult['"]/);
  assert.match(machineSafety, /from ['"]\.\.\/controllers\/ControllerStatus['"]/);
  assert.match(machineSafety, /export type \{ ControllerStatus \}/);
});

