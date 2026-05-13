/**
 * T1-115: GRBL `Door` reports must be a first-class status. Pre-T1-115
 * `_handleStatusReport`'s hardcoded statusMap silently dropped
 * `<Door|...>` / `<Door:0|...>` / `<Door:1|...>` reports, the public
 * `MachineStatus` enum had no `'door'` member, and the connect-time
 * classifier carried an explicit "the 'door' GRBL status is
 * intentionally not classified here" carve-out. Net effect: a live
 * door-open / e-stop / lid-switch event during idle would not block
 * job start, frame, jog, or test-fire — the user could trigger
 * motion or laser while the safety interlock was open.
 *
 * Post-T1-115:
 *   - `MachineStatus` includes `'door'`.
 *   - `_handleStatusReport`'s statusMap recognizes `door`, `door:0`,
 *     `door:1`, `door:2`, `door:3`.
 *   - `_classifySafeStateReason` raises `'door'` as an unsafe-at-
 *     connect verdict.
 *   - `MachinePreflight` carries a "Safety door / interlock is
 *     active" message for `door` and the `MACHINE_DOOR` rule blocks
 *     start in `MachineStatePreflight`.
 *
 * Run: npx tsx tests/door-status-classification.test.ts
 */
import { GrblController } from '../src/controllers/grbl/GrblController';
import { MockSerialPort } from '../src/communication/SerialPort';
import {
  PREFLIGHT_CODES,
  type PreflightContext,
} from '../src/core/preflight/Preflight';
import { runMachineStateChecks } from '../src/core/preflight/rules/MachineStatePreflight';
import { describeUnsafeAtConnect } from '../src/ui/components/connection/unsafeAtConnectMessages';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  PASS ${m}`);
  } else {
    failed++;
    console.error(`  FAIL ${m}`);
  }
}

function flush(ms = 30): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function portWith(statusResponse: string): MockSerialPort {
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
  port.nextStatusQueryResponse = statusResponse;
  return port;
}

console.log('\n=== T1-115 GRBL Door first-class status ===\n');

async function run(): Promise<void> {
  // ── 1. <Door|...> first status → status='door' + verdict='door' ──
  {
    const port = portWith('<Door|MPos:0.000,0.000,0.000|FS:0,0>');
    port.open();
    const ctrl = new GrblController();
    await ctrl.connect(port);
    await flush(300);
    const state = ctrl.state;
    assert(state.status === 'door',
      `<Door|...> live status maps to 'door' (got '${state.status}')`);
    const verdict = ctrl.getUnsafeAtConnect();
    assert(verdict != null, '<Door|...> at connect: verdict captured');
    assert(verdict?.reason === 'door',
      `<Door|...> at connect: reason='door' (got '${verdict?.reason}')`);
    assert(verdict?.status === 'door',
      `<Door|...> at connect: snapshot.status='door' (got '${verdict?.status}')`);
    await ctrl.disconnect();
  }

  // ── 2. <Door:0|...> first status → status='door' ──
  {
    const port = portWith('<Door:0|MPos:0.000,0.000,0.000|FS:0,0>');
    port.open();
    const ctrl = new GrblController();
    await ctrl.connect(port);
    await flush(300);
    const state = ctrl.state;
    assert(state.status === 'door',
      `<Door:0|...> maps to 'door' (got '${state.status}')`);
    await ctrl.disconnect();
  }

  // ── 3. <Door:1|...> first status → status='door' ──
  {
    const port = portWith('<Door:1|MPos:0.000,0.000,0.000|FS:0,0>');
    port.open();
    const ctrl = new GrblController();
    await ctrl.connect(port);
    await flush(300);
    const state = ctrl.state;
    assert(state.status === 'door',
      `<Door:1|...> maps to 'door' (got '${state.status}')`);
    await ctrl.disconnect();
  }

  // ── 4. Door subphases :2/:3 also map to 'door' (parking / restoring) ──
  {
    const port = portWith('<Door:2|MPos:0.000,0.000,0.000|FS:0,0>');
    port.open();
    const ctrl = new GrblController();
    await ctrl.connect(port);
    await flush(300);
    assert(ctrl.state.status === 'door',
      `<Door:2|...> maps to 'door' (parking subphase)`);
    await ctrl.disconnect();
  }

  // ── 5. Disconnect clears the door verdict ──
  {
    const port = portWith('<Door|MPos:0.000,0.000,0.000|FS:0,0>');
    port.open();
    const ctrl = new GrblController();
    await ctrl.connect(port);
    await flush(300);
    assert(ctrl.getUnsafeAtConnect() != null,
      'pre-disconnect: door verdict present');
    await ctrl.disconnect();
    assert(ctrl.getUnsafeAtConnect() === null,
      'post-disconnect: door verdict cleared');
  }

  // ── 6. Preflight blocks on machine status === 'door' ──
  {
    const ctx = {
      scene: { objects: [], layers: [] } as never,
      profile: null,
      optimizeOrderEnabled: true,
      preflightBedWidthMm: 300,
      preflightBedHeightMm: 300,
      machineStatus: 'door' as const,
      connectedToMachine: true,
      hasGcode: true,
    } as unknown as PreflightContext;
    const findings = [] as ReturnType<typeof runMachineStateChecks> extends void ? Array<{ severity: string; code: string; message: string }> : never;
    const out: Array<{ severity: string; code: string; message: string }> = [];
    runMachineStateChecks(ctx, out as never);
    const door = out.find((f) => f.code === PREFLIGHT_CODES.MACHINE_DOOR);
    assert(door != null,
      'machineStatus="door" produces a MACHINE_DOOR preflight finding');
    assert(door?.severity === 'error',
      'MACHINE_DOOR is severity error (blocking)');
    assert(/door/i.test(door?.message ?? ''),
      'MACHINE_DOOR message mentions door / interlock');

    // door must NOT also fall through to the MACHINE_NOT_IDLE warning.
    const notIdle = out.find((f) => f.code === PREFLIGHT_CODES.MACHINE_NOT_IDLE);
    assert(notIdle == null,
      'machineStatus="door" does NOT produce a MACHINE_NOT_IDLE warning (door is its own blocker)');
  }

  // ── 7. unsafeAtConnectMessages provides a door-specific message ──
  {
    const msg = describeUnsafeAtConnect('door');
    assert(/interlock|door/i.test(msg.headline),
      `door message headline mentions interlock (got '${msg.headline}')`);
    assert(/close|release|reconnect/i.test(msg.detail),
      `door message detail explains recovery (got '${msg.detail.slice(0, 80)}...')`);
    assert(msg.actionKind === 'reconnect',
      `door message actionKind is 'reconnect' (got '${msg.actionKind}')`);
  }

  // ── 8. Source-level pin: door is in the statusMap and removed from the carve-out comment ──
  {
    const here = dirname(fileURLToPath(import.meta.url));
    const grblSrc = readFileSync(
      resolve(here, '../src/controllers/grbl/GrblController.ts'),
      'utf-8',
    );
    // T1-124: the runtime statusMap moved from GrblController._handleStatusReport
    // to GrblStatusReportParser.ts as part of the audit's Sprint 4
    // "extract pure parsers first" sequence. Source-pin the parser
    // module directly; GrblController is now just verified to delegate
    // to the parser.
    assert(/parseGrblStatusReport\(raw\)/.test(grblSrc),
      'GrblController._handleStatusReport delegates to parseGrblStatusReport');
    const parserSrc = readFileSync(
      resolve(here, '../src/controllers/grbl/GrblStatusReportParser.ts'),
      'utf-8',
    );
    assert(/door:\s*'door'/.test(parserSrc),
      'GrblStatusReportParser.ts statusMap includes door entry');
    assert(/'door:0':\s*'door'/.test(parserSrc),
      'GrblStatusReportParser.ts statusMap includes door:0 entry');
    assert(/T1-followup-safety-door|T1-115/.test(grblSrc + parserSrc),
      'door support carries the T1-followup-safety-door / T1-115 marker somewhere in the GRBL parser stack');
    assert(!/'door' GRBL status is intentionally not classified/.test(grblSrc + parserSrc),
      "GRBL parser stack no longer carries the 'intentionally not classified' carve-out comment");

    const ifaceSrc = readFileSync(
      resolve(here, '../src/controllers/ControllerInterface.ts'),
      'utf-8',
    );
    assert(/\|\s*'door'/.test(ifaceSrc),
      "ControllerInterface.ts MachineStatus union includes 'door'");

    const preflightContextSrc = readFileSync(
      resolve(here, '../src/core/preflight/PreflightContext.ts'),
      'utf-8',
    );
    assert(/MACHINE_DOOR:\s*'MACHINE_DOOR'/.test(preflightContextSrc),
      'PreflightContext.ts PREFLIGHT_CODES includes MACHINE_DOOR');

    const ruleSrc = readFileSync(
      resolve(here, '../src/core/preflight/rules/MachineStatePreflight.ts'),
      'utf-8',
    );
    assert(/st === 'door'/.test(ruleSrc),
      'MachineStatePreflight checks st === door');
    assert(/MACHINE_DOOR/.test(ruleSrc),
      'MachineStatePreflight references MACHINE_DOOR code');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

void run();
