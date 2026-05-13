/**
 * T1-225 / F-007: `hashSceneForPersistence` is scene-domain logic and
 * must not force `core/job` to import from the app layer.
 *
 * Run: npx tsx tests/scene-dirty-hash-core-layer.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

console.log('\n=== T1-225 scene dirty hash core layer ===\n');

const root = process.cwd();
const coreSceneHashPath = path.join(root, 'src', 'core', 'scene', 'sceneDirtyHash.ts');
const appSceneHashPath = path.join(root, 'src', 'app', 'sceneDirtyHash.ts');
const jobFingerprintPath = path.join(root, 'src', 'core', 'job', 'JobFingerprint.ts');
const appPath = path.join(root, 'src', 'ui', 'components', 'App.tsx');
const dirtyDerivationTestPath = path.join(root, 'tests', 'dirty-derivation.test.ts');
const appMigrationTestPath = path.join(root, 'tests', 'dirty-state-app-migration.test.ts');

assert(fs.existsSync(coreSceneHashPath), 'scene dirty hash helper lives in src/core/scene');
assert(!fs.existsSync(appSceneHashPath), 'old src/app/sceneDirtyHash.ts file is removed');

const jobFingerprint = fs.readFileSync(jobFingerprintPath, 'utf-8');
const appSource = fs.readFileSync(appPath, 'utf-8');
const dirtyDerivationTest = fs.readFileSync(dirtyDerivationTestPath, 'utf-8');
const appMigrationTest = fs.readFileSync(appMigrationTestPath, 'utf-8');
const coreSceneHash = fs.existsSync(coreSceneHashPath)
  ? fs.readFileSync(coreSceneHashPath, 'utf-8')
  : '';

assert(/from '\.\.\/scene\/sceneDirtyHash'/.test(jobFingerprint), 'JobFingerprint imports scene dirty hash from core/scene');
assert(!/from ['"].*app\/sceneDirtyHash['"]/.test(jobFingerprint), 'JobFingerprint has no runtime app-layer import');
assert(/from '\.\.\/\.\.\/core\/scene\/sceneDirtyHash'/.test(appSource), 'App imports dirty helpers from core/scene');
assert(/from '\.\.\/src\/core\/scene\/sceneDirtyHash'/.test(dirtyDerivationTest), 'dirty derivation test imports core/scene helper');
assert(appMigrationTest.includes("import { hashSceneForPersistence, isDirty } from '../../core/scene/sceneDirtyHash'"),
  'dirty-state app migration pin expects App to import from core/scene');
assert(/T1-225/.test(coreSceneHash), 'core scene dirty hash file carries T1-225 marker');
assert(/T2-88/.test(coreSceneHash), 'moved file preserves original T2-88 marker/history');
assert(/export function hashSceneForPersistence/.test(coreSceneHash), 'hashSceneForPersistence still exported');
assert(/export function isDirty/.test(coreSceneHash), 'isDirty still exported');
assert(/export function hasMeaningfulContent/.test(coreSceneHash), 'hasMeaningfulContent still exported');

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
