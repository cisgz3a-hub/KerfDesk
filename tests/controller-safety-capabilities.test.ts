/**
 * T2-43: typed `ControllerSafetyCapabilities`. Pre-T2-43 the safety
 * service assumed GRBL behaviour everywhere — pause is recoverable,
 * stop invalidates position, soft-reset is the e-stop, etc. T2-43
 * pins the type + the GRBL declaration + the refusal-reason helpers.
 *
 * Run: npx tsx tests/controller-safety-capabilities.test.ts
 */
import {
  grblSafetyCapabilities,
  reasonEmergencyStopRefused,
  reasonPauseRefused,
  reasonResumeAfterErrorRefused,
  reasonTestFireRefused,
  type ControllerSafetyCapabilities,
  type SafetyTristate,
} from '../src/controllers/ControllerSafetyCapabilities';

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

console.log('\n=== T2-43 ControllerSafetyCapabilities ===\n');

void (async () => {

// 1. GRBL declaration: every required field populated
{
  const c = grblSafetyCapabilities;
  assert(c.supportsEmergencyStop === true, 'GRBL: supportsEmergencyStop=true');
  assert(c.emergencyStopMethod === 'soft-reset', `GRBL: emergencyStopMethod='soft-reset' (got ${c.emergencyStopMethod})`);
  assert(typeof c.emergencyStopLatencyMs === 'number',
    'GRBL: emergencyStopLatencyMs is a number');
  assert(c.supportsRecoverablePause === true, 'GRBL: supportsRecoverablePause=true');
  assert(c.pauseStopsLaserOutput === 'unknown',
    `GRBL: pauseStopsLaserOutput='unknown' ($32 dependent) (got ${String(c.pauseStopsLaserOutput)})`);
  assert(c.pauseLatencyClass === 'realtime',
    `GRBL: pauseLatencyClass='realtime' (got ${c.pauseLatencyClass})`);
  assert(c.resumeRequiresStateRestore === true,
    'GRBL: resumeRequiresStateRestore=true (pause emits M5, resume reasserts M3/M4 S0 before cycle-start)');
  assert(c.resumeSupportedAfterError === false,
    'GRBL: resumeSupportedAfterError=false (alarm requires re-home)');
  assert(c.supportsLaserOff === true, 'GRBL: supportsLaserOff=true');
  assert(c.laserOffCanBeVerified === false,
    'GRBL: laserOffCanBeVerified=false (no readback)');
  assert(c.laserOffMethod === 'gcode-m5',
    `GRBL: laserOffMethod='gcode-m5' (got ${c.laserOffMethod})`);
  assert(c.supportsTestFire === true, 'GRBL: supportsTestFire=true');
  assert(c.testFireRequiresMotion === false, 'GRBL: testFireRequiresMotion=false');
  assert(c.testFireMaxDurationMs === 5000, `GRBL: testFireMaxDurationMs=5000 (got ${c.testFireMaxDurationMs})`);
  assert(c.disconnectStopsJob === true,
    'GRBL: disconnectStopsJob=true (host-streamed)');
  assert(c.stopInvalidatesPosition === true,
    'GRBL: stopInvalidatesPosition=true (soft-reset)');
  assert(c.stopRequiresRehome === true,
    'GRBL: stopRequiresRehome=true');
  assert(c.executionModel === 'lineStream',
    `GRBL: executionModel='lineStream' (got ${c.executionModel})`);
}

// 2. reasonEmergencyStopRefused: GRBL allows e-stop → null
{
  assert(reasonEmergencyStopRefused(grblSafetyCapabilities) === null,
    'GRBL e-stop allowed → null');
}

// 3. reasonEmergencyStopRefused: refused when unsupported
{
  const caps: ControllerSafetyCapabilities = {
    ...grblSafetyCapabilities,
    supportsEmergencyStop: false,
  };
  const reason = reasonEmergencyStopRefused(caps);
  assert(reason !== null && /not support emergency stop/i.test(reason),
    `unsupported e-stop: refusal mentions 'emergency stop' (got '${reason}')`);
}

// 4. reasonEmergencyStopRefused: refused when method=unsupported
{
  const caps: ControllerSafetyCapabilities = {
    ...grblSafetyCapabilities,
    emergencyStopMethod: 'unsupported',
  };
  assert(reasonEmergencyStopRefused(caps) !== null,
    `e-stop method='unsupported' refused`);
}

// 5. reasonPauseRefused: GRBL allows → null
{
  assert(reasonPauseRefused(grblSafetyCapabilities) === null,
    'GRBL pause allowed → null');
}

// 6. reasonPauseRefused: refused when supportsRecoverablePause=false
{
  const caps: ControllerSafetyCapabilities = {
    ...grblSafetyCapabilities,
    supportsRecoverablePause: false,
  };
  const reason = reasonPauseRefused(caps);
  assert(reason !== null && /pause/i.test(reason),
    `unsupported pause: refusal mentions 'pause' (got '${reason}')`);
}

// 7. reasonResumeAfterErrorRefused: GRBL refuses → reason mentions clear alarm
{
  const reason = reasonResumeAfterErrorRefused(grblSafetyCapabilities);
  assert(reason !== null && /alarm|re-home/i.test(reason),
    `GRBL resume-after-error: refusal mentions alarm or re-home (got '${reason}')`);
}

// 8. reasonResumeAfterErrorRefused: allowed when capability says yes
{
  const caps: ControllerSafetyCapabilities = {
    ...grblSafetyCapabilities,
    resumeSupportedAfterError: true,
  };
  assert(reasonResumeAfterErrorRefused(caps) === null,
    'resumeSupportedAfterError=true → null');
}

// 9. reasonTestFireRefused: within bounds → null
{
  assert(reasonTestFireRefused(grblSafetyCapabilities, 1000) === null,
    'GRBL test fire 1000ms (within 5000ms cap) → null');
}

// 10. reasonTestFireRefused: over cap → refusal naming both numbers
{
  const reason = reasonTestFireRefused(grblSafetyCapabilities, 6000);
  assert(reason !== null && reason.includes('6000') && reason.includes('5000'),
    `over-cap test fire: refusal includes 6000 and 5000 (got '${reason}')`);
}

// 11. reasonTestFireRefused: refused when unsupported
{
  const caps: ControllerSafetyCapabilities = {
    ...grblSafetyCapabilities,
    supportsTestFire: false,
  };
  const reason = reasonTestFireRefused(caps, 100);
  assert(reason !== null && /test fire/i.test(reason),
    `unsupported test fire: refusal mentions 'test fire' (got '${reason}')`);
}

// 12. SafetyTristate accepts 'unknown' as a valid value
{
  const t1: SafetyTristate = true;
  const t2: SafetyTristate = false;
  const t3: SafetyTristate = 'unknown';
  assert(t1 === true && t2 === false && t3 === 'unknown',
    `SafetyTristate accepts true | false | 'unknown'`);
}

// 13. Type-shape pin: every declared field on the GRBL declaration
{
  const requiredFields: Array<keyof ControllerSafetyCapabilities> = [
    'supportsEmergencyStop', 'emergencyStopMethod', 'emergencyStopLatencyMs',
    'supportsRecoverablePause', 'pauseStopsLaserOutput', 'pauseLatencyClass',
    'resumeRequiresStateRestore', 'resumeSupportedAfterError',
    'supportsLaserOff', 'laserOffCanBeVerified', 'laserOffMethod',
    'supportsTestFire', 'testFireRequiresMotion', 'testFireMaxDurationMs',
    'disconnectStopsJob', 'stopInvalidatesPosition', 'stopRequiresRehome',
    'executionModel',
  ];
  for (const f of requiredFields) {
    assert(grblSafetyCapabilities[f] !== undefined,
      `GRBL declaration: field '${String(f)}' populated`);
  }
}

// 14. Hypothetical Wi-Fi controller: disconnectStopsJob=false would be
//     a critical capability difference — covered by the type
{
  const wifi: ControllerSafetyCapabilities = {
    ...grblSafetyCapabilities,
    executionModel: 'uploadedFile',
    disconnectStopsJob: false,
    emergencyStopMethod: 'native-stop',
  };
  assert(wifi.disconnectStopsJob === false && wifi.executionModel === 'uploadedFile',
    `hypothetical Wi-Fi controller: type accepts uploadedFile + disconnectStopsJob=false`);
}

// 15. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/controllers/ControllerSafetyCapabilities.ts'), 'utf-8');
  assert(/T2-43/.test(src), 'T2-43 marker in ControllerSafetyCapabilities.ts');
  for (const id of [
    'ControllerSafetyCapabilities', 'EmergencyStopMethod', 'LaserOffMethod',
    'PauseLatencyClass', 'ExecutionModel', 'SafetyTristate',
    'grblSafetyCapabilities', 'reasonEmergencyStopRefused', 'reasonPauseRefused',
    'reasonResumeAfterErrorRefused', 'reasonTestFireRefused',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
