/**
 * T1-228: JobCompiler must not import runtime helpers from the Plan layer.
 *
 * Job compilation sits before planning in the pipeline. Shared compile-time
 * helpers belong in `core/job/`; the historical `core/plan/*` paths stay as
 * compatibility wrappers for callers that have not moved yet.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

test('JobCompiler imports compile helpers from the job layer, not plan', () => {
  const src = readFileSync('src/core/job/JobCompiler.ts', 'utf8');

  assert.doesNotMatch(src, /from ['"]\.\.\/plan\/OperationOrderer['"]/);
  assert.doesNotMatch(src, /from ['"]\.\.\/plan\/ScanningOffset['"]/);
  assert.doesNotMatch(src, /from ['"]\.\.\/plan\/SmartOverscan['"]/);
  assert.match(src, /from ['"]\.\/OperationOrderer['"]/);
  assert.match(src, /from ['"]\.\/ScanningOffset['"]/);
  assert.match(src, /from ['"]\.\/SmartOverscan['"]/);
});

test('shared compile helpers live under core/job with compatibility wrappers in plan', () => {
  for (const name of ['OperationOrderer', 'ScanningOffset', 'SmartOverscan']) {
    const jobPath = `src/core/job/${name}.ts`;
    const planPath = `src/core/plan/${name}.ts`;
    assert.equal(existsSync(jobPath), true, `${jobPath} exists`);
    assert.equal(existsSync(planPath), true, `${planPath} wrapper exists`);
    assert.match(readFileSync(jobPath, 'utf8'), /T1-228/);
    assert.match(readFileSync(planPath, 'utf8'), new RegExp(`from ['"]\\.\\.\\/job\\/${name}['"]`));
  }
});

test('upstream scene/device/job types no longer import plan scanning-offset types', () => {
  const files = [
    'src/core/job/Job.ts',
    'src/core/scene/Layer.ts',
    'src/core/devices/DeviceProfile.ts',
  ];

  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /from ['"]\.\.\/plan\/ScanningOffset['"]/, file);
  }
});
