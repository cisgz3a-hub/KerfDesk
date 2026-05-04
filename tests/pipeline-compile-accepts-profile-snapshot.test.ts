/**
 * T1-58: PipelineService.compileGcode and compileToolpath accept a profile
 * snapshot from the caller instead of reading getActiveProfile() globally
 * mid-compile. Pre-T1-58 the pipeline read global state on each call, which
 * created a determinism bug: if the active profile flipped between the
 * caller's decision-to-compile and the read (programmatic profile change,
 * profile import, cross-tab storage event), the result was computed against
 * a profile the UI didn't know was active.
 *
 * After T1-58 the pipeline takes `profile: DeviceProfile | null` as the 8th
 * positional parameter (compileGcode) / 3rd parameter (compileToolpath).
 * useCompileManager snapshots `getActiveProfile()` at compile-entry and
 * passes the snapshot through.
 *
 * Run: npx tsx tests/pipeline-compile-accepts-profile-snapshot.test.ts
 */
import {
  compileGcode,
  compileToolpath,
} from '../src/app/PipelineService';
import { createBlankProfile } from '../src/core/devices/DeviceProfile';
import { createScene } from '../src/core/scene/Scene';
import { defaultLaserSettings } from '../src/core/scene/Layer';
import { createRect } from '../src/core/scene/SceneObject';
import type { Scene } from '../src/core/scene/Scene';
import type { Layer } from '../src/core/scene/Layer';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

console.log('\n=== T1-58 compileGcode/compileToolpath take profile snapshot ===\n');

async function run(): Promise<void> {

function sceneWithRect(): Scene {
  const scene = createScene(300, 200, 't1-58 test');
  const layer: Layer = {
    id: 'L1',
    name: 'Cut',
    color: '#000',
    visible: true,
    locked: false,
    output: true,
    order: 0,
    settings: defaultLaserSettings('cut'),
  };
  scene.layers = [layer];
  scene.objects = [createRect('L1', 10, 10, 50, 30, 'rect-1')];
  return scene;
}

// ── 1. compileGcode with explicit profile snapshot uses that profile ──
{
  const scene = sceneWithRect();
  const profileA = createBlankProfile('A');
  profileA.maxSpindle = 1000;
  profileA.bedWidth = 300;
  profileA.bedHeight = 200;
  const resultA = await compileGcode(
    scene, 'current', null, null, 'grbl', null, null, profileA,
  );
  assert(resultA != null, 'compileGcode returns a result with profile A');

  const profileB = createBlankProfile('B');
  profileB.maxSpindle = 255;        // CNC-style max
  profileB.bedWidth = 300;
  profileB.bedHeight = 200;
  const resultB = await compileGcode(
    scene, 'current', null, null, 'grbl', null, null, profileB,
  );
  assert(resultB != null, 'compileGcode returns a result with profile B');

  // Profile A and B differ in maxSpindle (1000 vs 255). The same scene + same
  // controller settings produces different S values in the gcode.
  assert(
    resultA?.gcode !== resultB?.gcode,
    'distinct profile snapshots produce distinct gcode (S-scale differs)',
  );
}

// ── 2. compileGcode with controllerMaxSpindle wins over profile (T1-33) ──
//    Verify the precedence flip still holds when profile is passed explicitly.
{
  const scene = sceneWithRect();
  const profile = createBlankProfile('test');
  profile.maxSpindle = 1000;
  profile.bedWidth = 300;
  profile.bedHeight = 200;

  // ctrl=255 should win even though profile=1000
  const resultCtrl = await compileGcode(
    scene, 'current', null, /* controllerMaxSpindle */ 255, 'grbl', null, null, profile,
  );
  // No ctrl → falls back to profile=1000
  const resultProfile = await compileGcode(
    scene, 'current', null, null, 'grbl', null, null, profile,
  );
  assert(resultCtrl != null && resultProfile != null, 'both compile paths returned');
  assert(
    resultCtrl?.gcode !== resultProfile?.gcode,
    'controller $30 still wins over profile.maxSpindle (T1-33 precedence preserved)',
  );
}

// ── 3. compileGcode with profile=null falls back to default (1000 maxSpindle) ──
{
  const scene = sceneWithRect();
  const result = await compileGcode(
    scene, 'current', null, null, 'grbl', null, null, null,
  );
  assert(result != null, 'compileGcode with profile=null still produces output (default fallback)');
}

// ── 4. compileToolpath with profile snapshot uses profile.maxFeedRate ──
{
  const scene = sceneWithRect();
  const profile = createBlankProfile('test');
  profile.maxFeedRate = 6000;
  const result = await compileToolpath(scene, null, profile);
  assert(result != null, 'compileToolpath returns moves with profile snapshot');
  assert(result?.moves != null && result.moves.length > 0, 'compileToolpath has moves');
}

// ── 5. compileToolpath with profile=null falls back to default (no throw) ──
{
  const scene = sceneWithRect();
  const result = await compileToolpath(scene, null, null);
  assert(result != null, 'compileToolpath with profile=null still produces moves');
}

// ── 6. Source-level pin: getActiveProfile call is gone from inside both functions ──
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(
    path.resolve(here, '../src/app/PipelineService.ts'),
    'utf-8',
  );
  assert(/T1-58/.test(src), 'T1-58 marker present in PipelineService.ts');

  // Locate the compileGcode body and assert no internal getActiveProfile() call.
  const cgStart = src.indexOf('export async function compileGcode(');
  const cgEnd = src.indexOf('export async function compileToolpath(');
  const cgBody = src.slice(cgStart, cgEnd);
  assert(cgBody.length > 0, 'compileGcode body located');
  assert(!/const profile = getActiveProfile\(\);/.test(cgBody),
    'compileGcode body no longer calls getActiveProfile() internally');
  assert(/profile: DeviceProfile \| null/.test(cgBody),
    'compileGcode signature declares profile: DeviceProfile | null parameter');

  // Same for compileToolpath.
  const ctStart = cgEnd;
  const ctBody = src.slice(ctStart);
  assert(!/const profile = getActiveProfile\(\);/.test(ctBody),
    'compileToolpath body no longer calls getActiveProfile() internally');
  assert(/profile: DeviceProfile \| null/.test(ctBody),
    'compileToolpath signature declares profile: DeviceProfile | null parameter');

  // Caller-side: useCompileManager snapshots profile and passes it through.
  const hookSrc = fs.readFileSync(
    path.resolve(here, '../src/ui/hooks/useCompileManager.ts'),
    'utf-8',
  );
  assert(/T1-58/.test(hookSrc), 'T1-58 marker present in useCompileManager.ts');
  assert(/const profileSnapshot = getActiveProfile\(\)/.test(hookSrc),
    'useCompileManager snapshots profile via getActiveProfile() at compile entry');
  // Snapshot is passed through as the 8th positional arg in both
  // compileGcode call sites.
  const passThroughCount = (hookSrc.match(/profileSnapshot,?\s*\n?\s*\)/g) ?? []).length;
  assert(passThroughCount >= 2,
    `useCompileManager forwards profileSnapshot to pipelineCompileGcode at all call sites (got ${passThroughCount})`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
