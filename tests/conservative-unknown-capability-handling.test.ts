/**
 * T3-56: connected real hardware must not treat unknown laser-mode capability
 * as safe for dynamic-power M4 output. Offline/export mode may still compile
 * from profile/default values.
 *
 * Run: npx tsx tests/conservative-unknown-capability-handling.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createBlankProfile } from '../src/core/devices/DeviceProfile';
import { PREFLIGHT_CODES, runPreflight, runPreflightSummary, type PreflightContext } from '../src/core/preflight/Preflight';
import { defaultLaserSettings } from '../src/core/scene/Layer';
import type { Scene } from '../src/core/scene/Scene';
import type { MachineState } from '../src/controllers/ControllerInterface';

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

function scene(): Scene {
  return {
    canvas: { width: 300, height: 200 },
    layers: [{
      id: 'cut',
      name: 'Cut',
      color: '#ff3366',
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
  connected: boolean;
  hasGcode?: boolean;
  outputUsesM4?: boolean;
  laserMode?: boolean;
}): PreflightContext {
  return {
    scene: scene(),
    profile: createBlankProfile('Test'),
    optimizeOrderEnabled: true,
    preflightBedWidthMm: 300,
    preflightBedHeightMm: 200,
    connectedToMachine: opts.connected,
    machineStatus: opts.connected ? 'idle' : null,
    hasGcode: opts.hasGcode ?? true,
    outputUsesM4: opts.outputUsesM4 ?? true,
    machinePlanBounds: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
    liveMachineInfo: typeof opts.laserMode === 'boolean' ? { laserMode: opts.laserMode } : {},
  };
}

function idle(status: MachineState['status'] = 'idle'): MachineState {
  return {
    status,
    position: { x: 0, y: 0, z: 0 },
    feedRate: 0,
    spindleSpeed: 0,
    alarmCode: null,
    errorCode: null,
  };
}

console.log('\n=== T3-56 conservative unknown capability handling ===\n');

{
  const result = runPreflight(ctx({ connected: true }));
  const issue = result.find(x => x.code === PREFLIGHT_CODES.MACHINE_LASER_MODE_UNKNOWN);
  assert(issue != null, 'connected + M4 output + unknown $32 raises blocker');
  assert(issue?.severity === 'error', 'unknown laser-mode severity is error');
  assert(/\$32/.test(issue?.message ?? ''), 'message names $32 laser mode');
}

{
  const result = runPreflight(ctx({ connected: true, laserMode: true }));
  const issue = result.find(x => x.code === PREFLIGHT_CODES.MACHINE_LASER_MODE_UNKNOWN);
  assert(!issue, 'verified $32=1 allows M4 output');
}

{
  const result = runPreflight(ctx({ connected: true, outputUsesM4: false }));
  const issue = result.find(x => x.code === PREFLIGHT_CODES.MACHINE_LASER_MODE_UNKNOWN);
  assert(!issue, 'unknown $32 does not block non-M4 output');
}

{
  const result = runPreflight(ctx({ connected: false }));
  const issue = result.find(x => x.code === PREFLIGHT_CODES.MACHINE_LASER_MODE_UNKNOWN);
  assert(!issue, 'offline/export mode does not block on unknown $32');
}

{
  const summary = runPreflightSummary(
    scene(),
    'G21\nM4 S100\nG1 X1 F100\nM5',
    idle('disconnected'),
    300,
    200,
    { minX: 0, minY: 0, maxX: 1, maxY: 1 },
  );
  const issue = summary.issues.find(x => x.id.startsWith(PREFLIGHT_CODES.MACHINE_LASER_MODE_UNKNOWN));
  assert(!issue, 'disconnected MachineState is not treated as connected hardware');
}

{
  const here = dirname(fileURLToPath(import.meta.url));
  const preflightSource = readFileSync(resolve(here, '../src/core/preflight/Preflight.ts'), 'utf-8');
  const preflightContextSource = readFileSync(resolve(here, '../src/core/preflight/PreflightContext.ts'), 'utf-8');
  const machineSource = readFileSync(resolve(here, '../src/core/preflight/rules/MachinePreflight.ts'), 'utf-8');

  assert(/MACHINE_LASER_MODE_UNKNOWN:\s*'MACHINE_LASER_MODE_UNKNOWN'/.test(preflightContextSource),
    'MACHINE_LASER_MODE_UNKNOWN code is declared');
  assert(/connectedToMachine:\s*machineState != null &&\s*machineState\.status !== 'disconnected'/.test(preflightSource),
    'runPreflightSummary does not treat disconnected MachineState as connected');
  assert(/T3-56/.test(machineSource), 'MachinePreflight carries T3-56 marker');
  assert(/liveLaserMode === undefined[\s\S]*ctx\.outputUsesM4/.test(machineSource),
    'unknown laser-mode guard keys on M4 output');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
