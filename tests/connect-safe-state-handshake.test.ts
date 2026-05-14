/**
 * T1-25: GrblController.connect runs a safe-state handshake. The first
 * status report after the welcome handshake records a verdict via
 * `getUnsafeAtConnect()`:
 *
 *   - null                       → idle + FS 0,0 (handshake passed)
 *   - 'alarm'                    → previous session ended in alarm
 *   - 'run' / 'hold'             → firmware thinks a job is active
 *   - 'check'                    → check mode is on
 *   - 'unsafe-residual-spindle'  → idle but FS spindle != 0 (modal M3/M4)
 *   - 'no-status-response'       → 5s watchdog elapsed without any status
 *
 * Plus the corresponding preflight blocker:
 *   MACHINE_UNSAFE_AT_CONNECT (severity: error) raised by MachinePreflight
 *   when ctx.liveMachineInfo.unsafeAtConnect is non-null.
 *
 * Run: npx tsx tests/connect-safe-state-handshake.test.ts
 */
import { GrblController } from '../src/controllers/grbl/GrblController';
import { MockSerialPort } from '../src/communication/SerialPort';
import {
  runPreflight,
  PREFLIGHT_CODES,
  type PreflightContext,
} from '../src/core/preflight/Preflight';
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

function flush(ms = 30): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

console.log('\n=== T1-25 connect-time safe-state handshake ===\n');

async function run(): Promise<void> {

function portWith(statusResponse: string | null, blockStatus = false): MockSerialPort {
  const port = new MockSerialPort((line: string) => {
    if (line === '$$') {
      return [
        '$10=0', '$22=0', '$23=0', '$32=0', '$30=1000.000',
        '$110=10000.000', '$111=10000.000',
        '$120=10.000', '$121=10.000',
        '$130=400.000', '$131=300.000',
        'ok',
      ];
    }
    if (line === '$#') return ['[G54:0.000,0.000,0.000]', 'ok'];
    if (line === '' || line.startsWith(';')) return line === '' ? ['ok'] : [];
    if (line.startsWith('$') && !line.startsWith('$J=')) return ['ok'];
    return ['ok'];
  });
  if (blockStatus) {
    port.blockStatusQueryResponse = true;
  } else if (statusResponse !== null) {
    port.nextStatusQueryResponse = statusResponse;
  }
  return port;
}

// ── 1. Idle + FS 0,0 → handshake passes (verdict is null) ──
{
  const port = portWith('<Idle|MPos:0.000,0.000,0.000|WPos:0.000,0.000,0.000|FS:0,0>');
  port.open();
  const ctrl = new GrblController();
  await ctrl.connect(port);
  await flush(300);  // let polling fire + first status arrive
  const verdict = ctrl.getUnsafeAtConnect();
  assert(verdict === null,
    `idle + FS 0,0 → verdict null (got ${JSON.stringify(verdict)})`);
  await ctrl.disconnect();
}

// ── 2. Alarm at first status → reason 'alarm' ──
{
  const port = portWith('<Alarm|MPos:0.000,0.000,0.000|FS:0,0>');
  port.open();
  const ctrl = new GrblController();
  await ctrl.connect(port);
  await flush(300);
  const verdict = ctrl.getUnsafeAtConnect();
  assert(verdict != null, 'alarm: verdict captured');
  assert(verdict?.reason === 'alarm', `alarm: reason='alarm' (got ${verdict?.reason})`);
  assert(verdict?.status === 'alarm', 'alarm: snapshot.status === alarm');
  await ctrl.disconnect();
}

// ── 3. Run at first status → reason 'run' ──
{
  const port = portWith('<Run|MPos:0.000,0.000,0.000|FS:0,0>');
  port.open();
  const ctrl = new GrblController();
  await ctrl.connect(port);
  await flush(300);
  const verdict = ctrl.getUnsafeAtConnect();
  assert(verdict?.reason === 'run', `run: reason='run' (got ${verdict?.reason})`);
  await ctrl.disconnect();
}

// ── 4. Hold at first status → reason 'hold' ──
{
  const port = portWith('<Hold|MPos:0.000,0.000,0.000|FS:0,0>');
  port.open();
  const ctrl = new GrblController();
  await ctrl.connect(port);
  await flush(300);
  const verdict = ctrl.getUnsafeAtConnect();
  assert(verdict?.reason === 'hold', `hold: reason='hold' (got ${verdict?.reason})`);
  await ctrl.disconnect();
}

// ── 5. Idle but FS:1500,500 → reason 'unsafe-residual-spindle' ──
{
  const port = portWith('<Idle|MPos:0.000,0.000,0.000|WPos:0.000,0.000,0.000|FS:1500,500>');
  port.open();
  const ctrl = new GrblController();
  await ctrl.connect(port);
  await flush(300);
  const verdict = ctrl.getUnsafeAtConnect();
  assert(verdict?.reason === 'unsafe-residual-spindle',
    `idle + FS:1500,500 → reason='unsafe-residual-spindle' (got ${verdict?.reason})`);
  assert(verdict?.spindleSpeed === 500,
    `snapshot includes spindleSpeed (got ${verdict?.spindleSpeed})`);
  assert(verdict?.feedRate === 1500,
    `snapshot includes feedRate (got ${verdict?.feedRate})`);
  await ctrl.disconnect();
}

// ── 6. Disconnect clears the verdict ──
{
  const port = portWith('<Alarm|MPos:0.000,0.000,0.000|FS:0,0>');
  port.open();
  const ctrl = new GrblController();
  await ctrl.connect(port);
  await flush(300);
  assert(ctrl.getUnsafeAtConnect() != null, 'pre-disconnect: verdict present');
  await ctrl.disconnect();
  assert(ctrl.getUnsafeAtConnect() === null, 'post-disconnect: verdict cleared');
}

// ── 7. Source-level pin: watchdog timer + 5s constant ──
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(
    path.resolve(here, '../src/controllers/grbl/GrblController.ts'),
    'utf-8',
  );

  assert(/T1-25/.test(src), 'T1-25 marker present in GrblController.ts');
  assert(/_safeStateCheckArmed = false/.test(src),
    '_safeStateCheckArmed flag declared');
  assert(/_safeStateWatchdog: ReturnType<typeof setTimeout> \| null/.test(src),
    '_safeStateWatchdog timer field declared');
  assert(/_unsafeAtConnect: UnsafeAtConnectState \| null = null/.test(src),
    '_unsafeAtConnect verdict field declared');
  // 5s watchdog (5000ms literal somewhere near setTimeout for the watchdog)
  const watchdogIdx = src.indexOf('_safeStateWatchdog = setTimeout');
  const watchdogSlice = watchdogIdx >= 0 ? src.slice(watchdogIdx, watchdogIdx + 700) : '';
  assert(/, 5000\)/.test(watchdogSlice),
    'watchdog uses 5000ms timeout');
  assert(/reason:\s*'no-status-response'[\s\S]{0,260}for\s*\(const cb of this\._stateListeners\)/.test(watchdogSlice),
    'watchdog notifies state listeners after recording no-status-response');
  // _armSafeStateCheck called from welcome
  assert(/this\._armSafeStateCheck\(\);/.test(src),
    'welcome handler calls _armSafeStateCheck()');
  // disconnect cleanup
  assert(/this\._unsafeAtConnect = null;/.test(src),
    'disconnect / connect-entry clears _unsafeAtConnect');
  // _classifySafeStateReason exists
  assert(/_classifySafeStateReason\(\): UnsafeAtConnectReason \| null/.test(src),
    '_classifySafeStateReason private helper declared');
  // ControllerInterface declaration
  const ifSrc = fs.readFileSync(
    path.resolve(here, '../src/controllers/ControllerInterface.ts'),
    'utf-8',
  );
  assert(/getUnsafeAtConnect\?\(\):/.test(ifSrc),
    'ControllerInterface declares getUnsafeAtConnect optional method');
}

// ── 8. Preflight rule: MACHINE_UNSAFE_AT_CONNECT raised when verdict is non-null ──
function emptyScene(): Scene {
  return {
    canvas: { width: 300, height: 300 },
    layers: [{
      id: 'L1', name: 'Cut', color: '#000', visible: true, locked: false,
      output: true, order: 0, settings: defaultLaserSettings('cut'),
    }],
    objects: [],
  } as unknown as Scene;
}

function ctxFor(unsafeReason:
  | 'alarm' | 'run' | 'hold' | 'check'
  | 'no-status-response' | 'unsafe-residual-spindle' | null,
): PreflightContext {
  const profile = createBlankProfile('T1-25 test');
  profile.maxSpindle = 1000;
  return {
    scene: emptyScene(),
    profile,
    optimizeOrderEnabled: true,
    preflightBedWidthMm: 300,
    preflightBedHeightMm: 300,
    connectedToMachine: true,
    machineStatus: 'idle',
    hasGcode: true,
    machinePlanBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    liveMachineInfo: {
      maxSpindle: 1000,
      unsafeAtConnect: unsafeReason,
    },
  };
}

{
  // Each non-null reason raises the blocker with reason-specific text.
  const reasons = ['alarm', 'run', 'hold', 'check', 'no-status-response', 'unsafe-residual-spindle'] as const;
  for (const reason of reasons) {
    const r = runPreflight(ctxFor(reason));
    const blocker = r.find(x => x.code === PREFLIGHT_CODES.MACHINE_UNSAFE_AT_CONNECT);
    assert(blocker != null,
      `unsafeAtConnect=${reason} → MACHINE_UNSAFE_AT_CONNECT raised`);
    assert(blocker?.severity === 'error',
      `unsafeAtConnect=${reason} → severity=error (blocking)`);
  }

  // Reason-specific message text — alarm references $X, run references soft-
  // reset, hold references cycle-start, check references $C, no-status
  // references power-cycle, residual-spindle references M5.
  const alarmMsg = runPreflight(ctxFor('alarm')).find(x => x.code === PREFLIGHT_CODES.MACHINE_UNSAFE_AT_CONNECT)?.message ?? '';
  assert(/\$X/.test(alarmMsg), 'alarm message names $X recovery');
  const runMsg = runPreflight(ctxFor('run')).find(x => x.code === PREFLIGHT_CODES.MACHINE_UNSAFE_AT_CONNECT)?.message ?? '';
  assert(/soft-reset/i.test(runMsg) || /0x18/.test(runMsg), 'run message names soft-reset recovery');
  const noStatusMsg = runPreflight(ctxFor('no-status-response')).find(x => x.code === PREFLIGHT_CODES.MACHINE_UNSAFE_AT_CONNECT)?.message ?? '';
  assert(/Power-cycle/i.test(noStatusMsg), 'no-status-response message names power-cycle recovery');
  const residualMsg = runPreflight(ctxFor('unsafe-residual-spindle')).find(x => x.code === PREFLIGHT_CODES.MACHINE_UNSAFE_AT_CONNECT)?.message ?? '';
  assert(/M5/.test(residualMsg), 'unsafe-residual-spindle message names M5 recovery');
}

// ── 9. Preflight rule: null verdict → no blocker ──
{
  const r = runPreflight(ctxFor(null));
  const blocker = r.find(x => x.code === PREFLIGHT_CODES.MACHINE_UNSAFE_AT_CONNECT);
  assert(!blocker, 'unsafeAtConnect=null → no MACHINE_UNSAFE_AT_CONNECT');
}

// ── 10. Preflight rule source-level pin ──
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const ruleSrc = fs.readFileSync(
    path.resolve(here, '../src/core/preflight/rules/MachinePreflight.ts'),
    'utf-8',
  );
  const preflightSrc = fs.readFileSync(
    path.resolve(here, '../src/core/preflight/Preflight.ts'),
    'utf-8',
  );
  const preflightContextSrc = fs.readFileSync(
    path.resolve(here, '../src/core/preflight/PreflightContext.ts'),
    'utf-8',
  );
  assert(/T1-25/.test(ruleSrc), 'T1-25 marker present in MachinePreflight.ts');
  assert(/MACHINE_UNSAFE_AT_CONNECT:\s*'MACHINE_UNSAFE_AT_CONNECT'/.test(preflightContextSrc),
    'MACHINE_UNSAFE_AT_CONNECT preflight code constant declared');
  assert(/firmwareUnsafeAtConnect\?:/.test(preflightSrc),
    'runPreflightSummary takes firmwareUnsafeAtConnect parameter');
  assert(/unsafeAtConnect\?:/.test(preflightContextSrc),
    'liveMachineInfo.unsafeAtConnect declared');
  // ConnectionPanelMain wires it in
  const panelSrc = fs.readFileSync(
    path.resolve(here, '../src/ui/components/ConnectionPanelMain.tsx'),
    'utf-8',
  );
  assert(/controllerRef\.current\?\.getUnsafeAtConnect\?\.\(\)/.test(panelSrc),
    'ConnectionPanelMain reads getUnsafeAtConnect from the controller');
  assert(/const\s+unsafeAtConnectReason\s*=\s*unsafeAtConnectVerdict\?\.reason\s*\?\?\s*null/.test(panelSrc),
    'ConnectionPanelMain derives a stable unsafe-at-connect reason');
  assert(/runPreflightSummary[\s\S]*unsafeAtConnectReason/.test(panelSrc),
    'ConnectionPanelMain forwards verdict reason (or null) to runPreflightSummary');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
