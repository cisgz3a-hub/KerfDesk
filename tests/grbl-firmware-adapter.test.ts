/**
 * T1-194 (external audit High #15 implementation slice): GrblAdapter
 * implementing FirmwareAdapter over existing GRBL code.
 *
 * T1-192 shipped the type contract; T1-194 ships a real
 * implementation (the first one). Validates that `capabilities()`
 * matches GRBL semantics, `emit()` produces a real OutputArtifact
 * with a burn AABB, `validate()` flags missing `$30` and laser-mode
 * mismatch, `stream()` rejects with a "not yet wired" message
 * (the multi-week MachineService integration is deferred), and
 * `recover()` produces sensible plans per fault kind.
 *
 * Run: npx tsx tests/grbl-firmware-adapter.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGrblFirmwareAdapter } from '../src/controllers/GrblFirmwareAdapter';
import type { LiveMachineIdentity, MachineFault, MachineFaultKind, OutputArtifact } from '../src/controllers/FirmwareAdapter';
import { createEmptyJob, flatPathFromPoints, type Operation, type ResolvedLaserSettings } from '../src/core/job/Job';
import { optimizePlan } from '../src/core/plan/PlanOptimizer';

let passed = 0;
let failed = 0;

function assert(cond: unknown, message: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const here = dirname(fileURLToPath(import.meta.url));

console.log('\n=== T1-194 GrblFirmwareAdapter ===\n');

const adapter = getGrblFirmwareAdapter();

// -------- 1. id + capabilities --------
{
  assert(adapter.id === 'grbl', `adapter.id === 'grbl'`);
  const caps = adapter.capabilities();
  assert(caps.id === 'grbl', `caps.id === 'grbl'`);
  assert(caps.protocol === 'gcode-line-stream', `protocol === 'gcode-line-stream'`);
  assert(caps.supportsDynamicLaserPower === true, 'M4 dynamic laser power supported');
  assert(caps.supportsArcs === true, 'G2/G3 arcs supported');
  assert(caps.supportsRealtimeStatusQuery === true, '? realtime status supported');
  assert(caps.supportsWorkOffsetQuery === true, '$# work-offset query supported');
  assert(caps.disconnectStopsJob === true, 'disconnect halts (host-streamed)');
  assert(caps.maxSpindleStatic === null, 'maxSpindleStatic is null (read from live identity)');
}

// -------- 2. compileConstraints --------
{
  const c = adapter.compileConstraints();
  assert(c.flattenArcsToLines === false, 'GRBL does not need arcs flattened');
  assert(c.maxAccelMmPerS2 === null, 'maxAccel from live (null at static-config time)');
  assert(c.maxFeedMmPerMin === null, 'maxFeed from live');
}

// -------- 3. emit produces a real OutputArtifact --------
{
  // Tiny vector job: a single 10mm linear burn.
  const settings: ResolvedLaserSettings = {
    powerMin: 0, powerMax: 80, speed: 1200,
    passes: 1, zStepPerPass: 0,
    fillInterval: 0, fillAngle: 0, fillMode: 'line',
    fillBiDirectional: false, overscanning: 0, overcut: 0, leadIn: 0,
    tabCount: 0, tabWidth: 0, insideFirst: false, airAssist: false,
    accelAwarePower: false, maxAccelMmPerS2: 500, minPowerRatioAccel: 0.2,
    scanningOffsets: [],
  };
  const path = flatPathFromPoints([{ x: 0, y: 0 }, { x: 10, y: 0 }], false, 'p1');
  const op: Operation = {
    id: 'op-1', layerId: 'L', layerName: 'Cut', layerColor: '#000',
    order: 0, type: 'cut', settings,
    geometry: { type: 'vector', paths: [path] },
    bounds: { ...path.bounds },
  } as unknown as Operation;
  const job = createEmptyJob('T1-194-job', 'test-project');
  job.operations = [op];
  job.bounds = { ...path.bounds };
  const plan = optimizePlan(job);

  const artifact = adapter.emit(plan, job);
  assert(artifact.kind === 'gcode-lines', `artifact.kind === 'gcode-lines'`);
  assert(artifact.firmware === 'grbl', `artifact.firmware === 'grbl'`);
  if (artifact.kind === 'gcode-lines') {
    assert(artifact.lines.length > 0, 'emit produced at least 1 line of gcode');
    assert(artifact.lines.some(l => /M4|M5|G[01]/.test(l)), 'emit produced recognizable GRBL output');
  }
  // The burn AABB should be non-null (we have a real burn move).
  assert(artifact.burnBounds !== null, 'artifact.burnBounds non-null for a real burn');
  if (artifact.burnBounds) {
    assert(
      artifact.burnBounds.maxX > artifact.burnBounds.minX,
      'burn AABB has positive width',
    );
  }
}

// -------- 4. validate flags missing $30 --------
{
  const artifact: OutputArtifact = {
    kind: 'gcode-lines', firmware: 'grbl', lines: ['G21'], burnBounds: null,
  };
  const liveNoSpindle: LiveMachineIdentity = {
    firmwareVersion: '1.1h', buildOptions: null, maxSpindle: null,
    bedWidthMm: 400, bedHeightMm: 400, homingEnabled: false, laserMode: true,
  };
  const findings = adapter.validate(artifact, liveNoSpindle).findings;
  const codes = findings.map(f => f.code);
  assert(codes.includes('GRBL_MAX_SPINDLE_UNKNOWN'), 'missing $30 → GRBL_MAX_SPINDLE_UNKNOWN warning');
  const sw = findings.find(f => f.code === 'GRBL_MAX_SPINDLE_UNKNOWN');
  assert(sw?.severity === 'warning', '$30 finding is a warning (not blocker)');
}

// -------- 5. validate flags laser-mode = CNC --------
{
  const artifact: OutputArtifact = {
    kind: 'gcode-lines', firmware: 'grbl', lines: ['G21'], burnBounds: null,
  };
  const liveCncMode: LiveMachineIdentity = {
    firmwareVersion: '1.1h', buildOptions: null, maxSpindle: 1000,
    bedWidthMm: 400, bedHeightMm: 400, homingEnabled: false,
    laserMode: false, // <-- CNC / spindle mode
  };
  const findings = adapter.validate(artifact, liveCncMode).findings;
  const lm = findings.find(f => f.code === 'GRBL_LASER_MODE_DISABLED');
  assert(lm !== undefined, '$32=0 → GRBL_LASER_MODE_DISABLED error');
  assert(lm?.severity === 'error', 'laser-mode finding is blocker-level (error)');
}

// -------- 6. validate routes non-GRBL output to the wrong-firmware error --------
{
  const fakeMarlin: OutputArtifact = {
    kind: 'gcode-lines', firmware: 'marlin', lines: ['G21'], burnBounds: null,
  };
  const live: LiveMachineIdentity = {
    firmwareVersion: '1.1h', buildOptions: null, maxSpindle: 1000,
    bedWidthMm: 400, bedHeightMm: 400, homingEnabled: false, laserMode: true,
  };
  const findings = adapter.validate(fakeMarlin, live).findings;
  assert(
    findings.some(f => f.code === 'GRBL_ADAPTER_WRONG_FIRMWARE'),
    'non-GRBL output routed to GrblAdapter → wrong-firmware error',
  );
}

// -------- 7. stream() rejects with "not yet wired" --------
{
  const artifact: OutputArtifact = {
    kind: 'gcode-lines', firmware: 'grbl', lines: [], burnBounds: null,
  };
  const session = adapter.stream(artifact);
  assert(typeof session.sessionId === 'string' && session.sessionId.startsWith('grbl-'), 'session has grbl-prefixed sessionId');
  void session.completed.catch((err: unknown) => {
    assert(err instanceof Error, 'stream rejects with an Error');
    assert(
      /not yet wired/i.test((err as Error).message),
      'rejection message names the deferred wiring',
    );
  });
}

// -------- 8. recover() produces sensible plans per fault kind --------
{
  const faultKinds: MachineFaultKind[] = [
    'alarm', 'transport-error', 'safety-off-failed',
    'placement-uncertain', 'firmware-mismatch',
  ];
  for (const kind of faultKinds) {
    const event: MachineFault = { kind, message: 'test', observedAt: 0 };
    const plan = adapter.recover(event);
    assert(plan.faultKind === kind, `recover(${kind}): plan.faultKind matches`);
    assert(plan.steps.length >= 1, `recover(${kind}): plan has at least 1 step`);
    assert(plan.advisoryOnly === false, `recover(${kind}): non-advisory by default`);
  }
  // Alarm-specific: clear-alarm + re-home steps present.
  const alarmPlan = adapter.recover({ kind: 'alarm', message: 'ALARM:9', observedAt: 0 });
  const alarmStepKinds = new Set(alarmPlan.steps.map(s => s.kind));
  assert(alarmStepKinds.has('clear-alarm'), 'alarm plan includes clear-alarm step');
  assert(alarmStepKinds.has('re-home'), 'alarm plan includes re-home step');
}

// -------- 9. Source pins --------
{
  const src = readFileSync(resolve(here, '../src/controllers/GrblFirmwareAdapter.ts'), 'utf-8');
  assert(/T1-194/.test(src), 'GrblFirmwareAdapter.ts carries T1-194 marker');
  assert(/audit High #15/.test(src), 'cross-references audit High #15');
  assert(/implements FirmwareAdapter/.test(src), 'class implements FirmwareAdapter');
  assert(/getGrblFirmwareAdapter/.test(src), 'singleton accessor exported');
  assert(
    /T1-197/.test(src),
    'doc names the deferred multi-week wiring (T1-197 or later)',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
