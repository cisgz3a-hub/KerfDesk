/**
 * Long burns must not be interrupted by heavy autosave work.
 *
 * The compile path already suppresses compile/toolpath work while a job is
 * running because main-thread stalls can drain the GRBL planner. Autosave has
 * the same risk: hashing and serializing a large raster scene mid-burn can
 * pause the event loop long enough for host-streamed controllers to stop.
 *
 * Run: npx tsx tests/autosave-pauses-during-active-job.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

console.log('\n=== autosave pauses during active job ===\n');

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../src/ui/components/App.tsx'), 'utf-8');

const autosaveStart = source.indexOf('const interval = setInterval(() => {');
const autosaveEnd = source.indexOf('return () => clearInterval(interval);', autosaveStart);
const autosaveBody = autosaveStart >= 0 && autosaveEnd > autosaveStart
  ? source.slice(autosaveStart, autosaveEnd)
  : '';

assert(autosaveBody.length > 0, 'App autosave interval body was found');
assert(
  /grbl\.isJobRunning|controllerRef\.current\?\.isJobRunning/.test(autosaveBody),
  'autosave interval checks active job state',
);
assert(
  /if \([\s\S]{0,120}(?:grbl\.isJobRunning|controllerRef\.current\?\.isJobRunning)[\s\S]{0,120}\) return;/.test(autosaveBody),
  'autosave active-job check returns before persistence work',
);

const jobGuardIndex = Math.min(
  ...[
    autosaveBody.indexOf('grbl.isJobRunning'),
    autosaveBody.indexOf('controllerRef.current?.isJobRunning'),
  ].filter(i => i >= 0),
);
const dirtyIndex = autosaveBody.indexOf('hashSceneForPersistence(scene)');
const serializeIndex = autosaveBody.indexOf('serializeForAutosave(scene)');

assert(jobGuardIndex >= 0 && dirtyIndex >= 0 && jobGuardIndex < dirtyIndex,
  'active-job guard runs before autosave hashing');
assert(jobGuardIndex >= 0 && serializeIndex >= 0 && jobGuardIndex < serializeIndex,
  'active-job guard runs before serializeForAutosave');

const depsStart = source.indexOf('}, [scene', autosaveEnd);
const deps = depsStart >= 0 ? source.slice(depsStart, depsStart + 160) : '';
assert(/grbl\.isJobRunning/.test(deps), 'autosave effect dependency list includes grbl.isJobRunning');

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
