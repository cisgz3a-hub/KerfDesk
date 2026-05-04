/**
 * T1-33: live $30 controller value should win over profile.maxSpindle for
 * runtime power scaling, AND a >5% mismatch between profile and controller
 * should raise a blocking preflight error so the user reconciles before
 * burning. Two-part fix:
 *
 *  Part 1 — PipelineService.compileGcode flips precedence so controller $30
 *           wins when present and positive; profile is fallback only.
 *  Part 2 — MachinePreflight.ts raises MACHINE_MAXSPINDLE_MISMATCH when both
 *           values are set and they differ by more than 5%.
 *
 * Without this fix: profile=1000, controller=$30=255 silently produces
 * S=500 for "50% power" → firmware clamps to 255 → actual 100% output =
 * over-power, fire risk on flammable materials.
 *
 * Run: npx tsx tests/maxspindle-precedence-and-mismatch.test.ts
 */
import { runPreflight, PREFLIGHT_CODES, type PreflightContext } from '../src/core/preflight/Preflight';
import { createBlankProfile } from '../src/core/devices/DeviceProfile';
import type { Scene } from '../src/core/scene/Scene';
import { defaultLaserSettings } from '../src/core/scene/Layer';

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

console.log('\n=== T1-33 maxSpindle precedence + mismatch ===\n');

async function run(): Promise<void> {

function emptyScene(): Scene {
  return {
    canvas: { width: 300, height: 300 },
    layers: [{
      id: 'default',
      name: 'Cut',
      color: '#000',
      visible: true,
      locked: false,
      output: true,
      order: 0,
      settings: defaultLaserSettings('cut'),
    }],
    objects: [],
  } as unknown as Scene;
}

function ctx(opts: {
  profileMaxSpindle?: number;
  controllerMaxSpindle?: number;
}): PreflightContext {
  const profile = createBlankProfile('Test');
  if (typeof opts.profileMaxSpindle === 'number') {
    profile.maxSpindle = opts.profileMaxSpindle;
  }
  return {
    scene: emptyScene(),
    profile,
    optimizeOrderEnabled: true,
    preflightBedWidthMm: 300,
    preflightBedHeightMm: 300,
    connectedToMachine: typeof opts.controllerMaxSpindle === 'number',
    machineStatus: typeof opts.controllerMaxSpindle === 'number' ? 'idle' : null,
    hasGcode: true,
    machinePlanBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    liveMachineInfo:
      typeof opts.controllerMaxSpindle === 'number'
        ? { maxSpindle: opts.controllerMaxSpindle }
        : {},
  };
}

// ── Part 2: preflight mismatch detection ──

// 1. Profile=1000 controller=255 → MISMATCH error (severe diff, ~74% off)
{
  const results = runPreflight(ctx({ profileMaxSpindle: 1000, controllerMaxSpindle: 255 }));
  const r = results.find(x => x.code === PREFLIGHT_CODES.MACHINE_MAXSPINDLE_MISMATCH);
  assert(r != null, 'profile=1000 controller=255 → MISMATCH present');
  assert(r?.severity === 'error', 'MISMATCH severity = error (blocking)');
  assert(/1000/.test(r?.message ?? ''), 'message includes profile value (1000)');
  assert(/255/.test(r?.message ?? ''), 'message includes controller value (255)');
  assert(/\$30/.test(r?.message ?? ''), 'message references $30 for actionable remediation');
}

// 2. Profile=1000 controller=1000 → no mismatch
{
  const results = runPreflight(ctx({ profileMaxSpindle: 1000, controllerMaxSpindle: 1000 }));
  const r = results.find(x => x.code === PREFLIGHT_CODES.MACHINE_MAXSPINDLE_MISMATCH);
  assert(!r, 'profile=1000 controller=1000 → no MISMATCH');
}

// 3. Profile=1000 controller=970 (3% diff, within 5%) → no mismatch
{
  const results = runPreflight(ctx({ profileMaxSpindle: 1000, controllerMaxSpindle: 970 }));
  const r = results.find(x => x.code === PREFLIGHT_CODES.MACHINE_MAXSPINDLE_MISMATCH);
  assert(!r, 'profile=1000 controller=970 (3% drift) → no MISMATCH (within 5% tolerance)');
}

// 4. Profile=1000 controller=949 (5.1% diff) → mismatch
{
  const results = runPreflight(ctx({ profileMaxSpindle: 1000, controllerMaxSpindle: 949 }));
  const r = results.find(x => x.code === PREFLIGHT_CODES.MACHINE_MAXSPINDLE_MISMATCH);
  assert(r != null, 'profile=1000 controller=949 (5.1% drift) → MISMATCH (just outside tolerance)');
}

// 5. Profile=1000 controller=1051 (5.1% over) → mismatch (symmetric)
{
  const results = runPreflight(ctx({ profileMaxSpindle: 1000, controllerMaxSpindle: 1051 }));
  const r = results.find(x => x.code === PREFLIGHT_CODES.MACHINE_MAXSPINDLE_MISMATCH);
  assert(r != null, 'controller > profile by >5% → MISMATCH (symmetric tolerance)');
}

// 6. Profile=1000 controller missing (undefined) → no mismatch
{
  const results = runPreflight(ctx({ profileMaxSpindle: 1000 }));
  const r = results.find(x => x.code === PREFLIGHT_CODES.MACHINE_MAXSPINDLE_MISMATCH);
  assert(!r, 'profile only (controller disconnected) → no MISMATCH');
}

// 7. Profile missing controller=1000 → no mismatch (MISSING_MAX_SPINDLE handles profile-side)
{
  const results = runPreflight(ctx({ controllerMaxSpindle: 1000 }));
  const r = results.find(x => x.code === PREFLIGHT_CODES.MACHINE_MAXSPINDLE_MISMATCH);
  assert(!r, 'controller only (profile blank) → no MISMATCH (MISSING_MAX_SPINDLE separately covers)');
}

// 8. Profile=0 controller=1000 → no mismatch (zero profile is "blank" not "mismatch")
{
  const results = runPreflight(ctx({ profileMaxSpindle: 0, controllerMaxSpindle: 1000 }));
  const r = results.find(x => x.code === PREFLIGHT_CODES.MACHINE_MAXSPINDLE_MISMATCH);
  assert(!r, 'profile=0 controller=1000 → no MISMATCH (profile is blank not mis-set)');
}

// ── Part 1: precedence flip in PipelineService source ──

{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));

  const pipelineSrc = fs.readFileSync(
    path.resolve(here, '../src/app/PipelineService.ts'),
    'utf-8',
  );
  // The flipped precedence: controllerMaxSpindle wins when present, profile is fallback.
  assert(/T1-33/.test(pipelineSrc),
    'T1-33 marker present in PipelineService.ts');
  assert(
    /\(controllerMaxSpindle != null && controllerMaxSpindle > 0\)\s*\?\s*controllerMaxSpindle/.test(
      pipelineSrc,
    ),
    'PipelineService.compileGcode picks controllerMaxSpindle when present',
  );
  assert(
    /:\s*\(profile\?\.maxSpindle \?\? 1000\)/.test(pipelineSrc),
    'PipelineService.compileGcode falls back to profile.maxSpindle when no controller value',
  );

  // Ensure the OLD precedence is gone (profile wins line removed).
  assert(
    !/profile\?\.maxSpindle\s*\?\?\s*\(controllerMaxSpindle/.test(pipelineSrc),
    'OLD profile-wins precedence removed',
  );

  const preflightSrc = fs.readFileSync(
    path.resolve(here, '../src/core/preflight/Preflight.ts'),
    'utf-8',
  );
  assert(/MACHINE_MAXSPINDLE_MISMATCH:\s*'MACHINE_MAXSPINDLE_MISMATCH'/.test(preflightSrc),
    'MACHINE_MAXSPINDLE_MISMATCH preflight code constant declared');
  assert(/firmwareMaxSpindleFromMachine\?:\s*number/.test(preflightSrc),
    'runPreflightSummary takes firmwareMaxSpindleFromMachine parameter');

  const ruleSrc = fs.readFileSync(
    path.resolve(here, '../src/core/preflight/rules/MachinePreflight.ts'),
    'utf-8',
  );
  assert(/T1-33/.test(ruleSrc), 'T1-33 marker present in MachinePreflight.ts');
  assert(/ratio < 0\.95 \|\| ratio > 1\.05/.test(ruleSrc),
    'rule uses 5% symmetric tolerance band');

  const panelSrc = fs.readFileSync(
    path.resolve(here, '../src/ui/components/ConnectionPanelMain.tsx'),
    'utf-8',
  );
  assert(/controllerRef\.current\?\.maxSpindle/.test(panelSrc),
    'ConnectionPanelMain reads controller maxSpindle');
  assert(/typeof ctrlMaxSpindle === 'number' && ctrlMaxSpindle > 0/.test(panelSrc),
    'ConnectionPanelMain only passes maxSpindle when positive');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
