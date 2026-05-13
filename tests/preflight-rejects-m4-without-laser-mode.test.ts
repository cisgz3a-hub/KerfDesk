/**
 * T1-32: preflight must refuse jobs that emit M4 dynamic-power against a
 * controller reporting $32=0 (CNC / spindle mode). In CNC mode M4 keeps
 * the laser on at full S between motion commands — a fire / burn hazard
 * for diode lasers, especially during stationary planner stalls between
 * path segments.
 *
 * Rule lives in src/core/preflight/rules/MachinePreflight.ts; the live $32
 * value is sourced from GrblController.getFirmwareLaserModeEnabled() and
 * threaded via runPreflightSummary's new firmwareLaserModeFromMachine
 * parameter into PreflightContext.liveMachineInfo.laserMode.
 *
 * Run: npx tsx tests/preflight-rejects-m4-without-laser-mode.test.ts
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

console.log('\n=== T1-32 preflight rejects M4 without $32=1 ===\n');

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
  laserMode?: boolean;
  gcode?: string | null;
  hasGcode?: boolean;
}): PreflightContext {
  const profile = createBlankProfile('Test');
  profile.maxSpindle = 1000;
  return {
    scene: emptyScene(),
    profile,
    optimizeOrderEnabled: true,
    preflightBedWidthMm: 300,
    preflightBedHeightMm: 300,
    connectedToMachine: typeof opts.laserMode === 'boolean',
    machineStatus: typeof opts.laserMode === 'boolean' ? 'idle' : null,
    hasGcode: opts.hasGcode ?? (opts.gcode != null && opts.gcode.length > 0),
    machinePlanBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    outputUsesM4: opts.gcode != null && /\bM4\b/i.test(opts.gcode),
    liveMachineInfo: typeof opts.laserMode === 'boolean' ? { laserMode: opts.laserMode } : {},
  };
}

// ── 1. $32=1 + M4 gcode → no MACHINE_LASER_MODE_DISABLED issue ──
{
  const results = runPreflight(ctx({ laserMode: true, gcode: 'G0 X10\nM4 S500\nG1 X20 Y20\nM5\n' }));
  const offending = results.find(r => r.code === PREFLIGHT_CODES.MACHINE_LASER_MODE_DISABLED);
  assert(!offending, '$32=1 + M4 → no MACHINE_LASER_MODE_DISABLED');
}

// ── 2. $32=0 + M4 gcode → MACHINE_LASER_MODE_DISABLED at error severity ──
{
  const results = runPreflight(ctx({ laserMode: false, gcode: 'G0 X10\nM4 S500\nG1 X20 Y20\nM5\n' }));
  const offending = results.find(r => r.code === PREFLIGHT_CODES.MACHINE_LASER_MODE_DISABLED);
  assert(offending != null, '$32=0 + M4 → MACHINE_LASER_MODE_DISABLED present');
  assert(offending?.severity === 'error', '$32=0 + M4 → severity=error (blocking)');
  assert(/\$32=1/.test(offending?.message ?? ''), 'message points users at "$32=1" remediation');
  assert(/M3/.test(offending?.message ?? ''), 'message mentions M3 alternative');
}

// ── 3. $32=0 + M3 gcode (no M4) → no issue ──
{
  const results = runPreflight(ctx({ laserMode: false, gcode: 'G0 X10\nM3 S500\nG1 X20 Y20\nM5\n' }));
  const offending = results.find(r => r.code === PREFLIGHT_CODES.MACHINE_LASER_MODE_DISABLED);
  assert(!offending, '$32=0 + M3 (no M4) → no MACHINE_LASER_MODE_DISABLED');
}

// ── 4. Disconnected (laserMode undefined) + M4 gcode → no issue (skip until known) ──
{
  const results = runPreflight(ctx({ gcode: 'G0 X10\nM4 S500\nM5\n' }));
  const offending = results.find(r => r.code === PREFLIGHT_CODES.MACHINE_LASER_MODE_DISABLED);
  assert(!offending, 'disconnected + M4 → check skipped (laserMode unknown)');
}

// ── 5. $32=0 + no gcode → no issue (nothing to refuse yet) ──
{
  const results = runPreflight(ctx({ laserMode: false, gcode: null }));
  const offending = results.find(r => r.code === PREFLIGHT_CODES.MACHINE_LASER_MODE_DISABLED);
  assert(!offending, '$32=0 + no gcode → no MACHINE_LASER_MODE_DISABLED');
}

// ── 6. M4 detection is case-insensitive (firmware accepts both m4 and M4) ──
{
  const results = runPreflight(ctx({ laserMode: false, gcode: 'G0 X10\nm4 S500\nM5\n' }));
  const offending = results.find(r => r.code === PREFLIGHT_CODES.MACHINE_LASER_MODE_DISABLED);
  assert(offending != null, 'lowercase m4 still matches the rule');
}

// ── 7. M4 inside a comment is still treated as M4-emission (conservative)
//       The fix-it message tells the user to change templates if false-positive. ──
{
  const results = runPreflight(ctx({ laserMode: false, gcode: '; uses M4 dynamic\nG0 X10\nM3 S500\nM5\n' }));
  const offending = results.find(r => r.code === PREFLIGHT_CODES.MACHINE_LASER_MODE_DISABLED);
  assert(
    offending != null,
    'M4 in a comment is still flagged — \\bM4\\b matches comment text; conservative bias for safety',
  );
}

// ── 8. Source-level pin: PreflightContext exposes outputUsesM4 + liveMachineInfo.laserMode ──
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const preflightSrc = fs.readFileSync(
    path.resolve(here, '../src/core/preflight/Preflight.ts'),
    'utf-8',
  );
  const preflightContextSrc = fs.readFileSync(
    path.resolve(here, '../src/core/preflight/PreflightContext.ts'),
    'utf-8',
  );
  assert(/outputUsesM4\?:\s*boolean/.test(preflightContextSrc),
    'PreflightContext.outputUsesM4 declared');
  assert(/laserMode\?:\s*boolean/.test(preflightContextSrc),
    'liveMachineInfo.laserMode declared');
  assert(/MACHINE_LASER_MODE_DISABLED:\s*'MACHINE_LASER_MODE_DISABLED'/.test(preflightContextSrc),
    'MACHINE_LASER_MODE_DISABLED preflight code constant declared');
  assert(/firmwareLaserModeFromMachine\?:\s*boolean/.test(preflightSrc),
    'runPreflightSummary takes firmwareLaserModeFromMachine parameter');
  assert(/outputUsesM4: gcode != null && \/\\bM4\\b\/i\.test\(gcode\)/.test(preflightSrc),
    'runPreflightSummary computes outputUsesM4 once via M4 regex scan');

  const ruleSrc = fs.readFileSync(
    path.resolve(here, '../src/core/preflight/rules/MachinePreflight.ts'),
    'utf-8',
  );
  assert(/T1-32/.test(ruleSrc), 'T1-32 marker present in MachinePreflight.ts');
  assert(/liveLaserMode === false && ctx\.outputUsesM4/.test(ruleSrc),
    'rule guards on liveLaserMode === false && ctx.outputUsesM4');

  const controllerSrc = fs.readFileSync(
    path.resolve(here, '../src/controllers/grbl/GrblController.ts'),
    'utf-8',
  );
  assert(/getFirmwareLaserModeEnabled\(\): boolean \| undefined/.test(controllerSrc),
    'GrblController.getFirmwareLaserModeEnabled signature present');
  assert(/this\._grblSettings\.has\(32\)/.test(controllerSrc),
    'getFirmwareLaserModeEnabled reads from $$ cache (key 32)');

  const interfaceSrc = fs.readFileSync(
    path.resolve(here, '../src/controllers/ControllerInterface.ts'),
    'utf-8',
  );
  assert(/getFirmwareLaserModeEnabled\?\(\): boolean \| undefined/.test(interfaceSrc),
    'ControllerInterface declares getFirmwareLaserModeEnabled');

  const panelSrc = fs.readFileSync(
    path.resolve(here, '../src/ui/components/ConnectionPanelMain.tsx'),
    'utf-8',
  );
  assert(/controllerRef\.current\?\.getFirmwareLaserModeEnabled\?\.\(\)/.test(panelSrc),
    'ConnectionPanelMain wires getFirmwareLaserModeEnabled into runPreflightSummary');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
