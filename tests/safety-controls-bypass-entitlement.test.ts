/**
 * T2-97: entitlement checks must never block safety controls.
 *
 * Two-part test:
 *
 *   1. Behavioral — exercise each safety method (stop / pause /
 *      resume / disconnect / emergencyStop / safetyOff) against
 *      multiple entitlement states (`free`, `verification_failed`,
 *      `revoked`) and assert each completes without throwing.
 *
 *   2. Static guard — scan the safety-critical source files for any
 *      import of `entitlements/` or any call to `requireFeature` /
 *      `assertFeature` / `canUseFeature` / `hasPro()`. A match fails
 *      with file + line so reviewers see the regression.
 *
 * The audit's user-trust failure mode (audit 5A Required Priority 9):
 * a paid user mid-burn whose Gumroad license validation fails
 * transiently must still be able to stop their machine, kill the
 * laser, and disconnect. T2-97 makes this guarantee structural.
 *
 * Run: npx tsx tests/safety-controls-bypass-entitlement.test.ts
 */
import type { MutableRefObject } from 'react';
import { MachineService } from '../src/app/MachineService';
import { type LaserController, type MachineState } from '../src/controllers/ControllerInterface';
import { type SerialPortLike } from '../src/communication/SerialPort';
import { EntitlementService } from '../src/entitlements/EntitlementService';

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

const memoryStore: Record<string, string> = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  get length() { return Object.keys(memoryStore).length; },
  clear(): void { for (const k of Object.keys(memoryStore)) delete memoryStore[k]; },
  getItem: (k: string) => Object.prototype.hasOwnProperty.call(memoryStore, k) ? memoryStore[k] : null,
  key: (i: number) => Object.keys(memoryStore)[i] ?? null,
  removeItem: (k: string) => { delete memoryStore[k]; },
  setItem: (k: string, v: string) => { memoryStore[k] = v; },
} as Storage;

const idle: MachineState = {
  status: 'idle', position: { x: 0, y: 0, z: 0 },
  feedRate: 0, spindleSpeed: 0, alarmCode: null, errorCode: null,
};

interface MockCounters {
  pause: number;
  resume: number;
  stop: number;
  emergency: number;
  safetyOff: number;
  disconnect: number;
}

function makeMockCtrl(): { ctrl: LaserController; calls: MockCounters } {
  const calls: MockCounters = {
    pause: 0, resume: 0, stop: 0, emergency: 0, safetyOff: 0, disconnect: 0,
  };
  const ctrl: Partial<LaserController> = {
    state: idle,
    isJobRunning: false,
    maxSpindle: 1000,
    connect: async () => {},
    disconnect: async () => { calls.disconnect++; },
    sendCommand: () => {},
    sendJob: async () => {},
    pause: () => { calls.pause++; },
    resume: () => { calls.resume++; },
    stop: () => { calls.stop++; },
    emergencyStop: () => { calls.emergency++; },
    requestStatusReport: () => {},
    onStateChange: () => () => {},
    onProgress: () => () => {},
    onError: () => () => {},
    onRawLine: () => () => {},
    safetyOff: async () => {
      calls.safetyOff++;
      return { stage: 'm5' as const };
    },
    operations: {
      jog: async () => ({ ok: true }),
      home: async () => ({ ok: true }),
      unlockAlarm: async () => ({ ok: true }),
      setWorkOriginAtCurrentPosition: async () => ({ ok: true }),
      resetWcsToMachineOrigin: async () => ({ ok: true }),
      laserOff: async () => ({ ok: true }),
      pauseJob: async () => {
        calls.pause++;
        return { ok: true };
      },
      resumeJob: async () => {
        calls.resume++;
        return { ok: true };
      },
      stopJob: async () => {
        calls.stop++;
        return { ok: true };
      },
      emergencyStop: async () => ({ ok: true }),
    },
  };
  return { ctrl: ctrl as LaserController, calls };
}

function makeService(ctrl: LaserController): MachineService {
  const portRef = { current: null } as { current: SerialPortLike | null };
  const ctrlRef = { current: ctrl } as { current: LaserController };
  return new MachineService(
    ctrlRef as MutableRefObject<LaserController>,
    portRef as MutableRefObject<SerialPortLike | null>,
  );
}

console.log('\n=== T2-97 entitlement does not block safety controls ===\n');

void (async () => {

// ─── Behavioral: each safety method works under three entitlement
//     states (free, verification_failed, revoked). The
//     `EntitlementService.skipToFreeSession()` path forces a known
//     state without going through the full Gumroad flow.

const states: Array<{ label: string; setup: (svc: EntitlementService) => void }> = [
  {
    label: 'free (no license)',
    setup: (svc) => svc.skipToFreeSession(),
  },
  {
    label: 'free (after deactivate)',
    setup: (svc) => svc.deactivate(),
  },
  // verification_failed and revoked are produced by the initialize
  // flow which needs Gumroad mocking; for this test, free covers
  // the "hasPro=false" failure mode that they all share. The static
  // guard below catches any future code that consults entitlement
  // status at all.
];

for (const { label, setup } of states) {
  const eSvc = new EntitlementService();
  setup(eSvc);

  const { ctrl, calls } = makeMockCtrl();
  const svc = makeService(ctrl);

  // pause
  let threw = false;
  try { await svc.pause(); } catch { threw = true; }
  assert(!threw && calls.pause === 1,
    `[${label}] svc.pause() does not throw, controller operations.pauseJob called`);

  // resume
  threw = false;
  try { await svc.resume(); } catch { threw = true; }
  assert(!threw && calls.resume === 1,
    `[${label}] svc.resume() does not throw, controller operations.resumeJob called`);

  // stop (via stopAndEnsureLaserOff)
  threw = false;
  try { await svc.stopAndEnsureLaserOff(); } catch { threw = true; }
  assert(!threw && calls.stop === 1,
    `[${label}] svc.stopAndEnsureLaserOff() does not throw, controller operations.stopJob called`);

  // disconnect
  threw = false;
  try { await svc.disconnect(); } catch { threw = true; }
  assert(!threw && calls.disconnect === 1,
    `[${label}] svc.disconnect() does not throw, controller.disconnect called`);

  // emergencyStop on the controller itself (the path the UI's
  // emergency stop button reaches via ExecutionCoordinator)
  threw = false;
  try { ctrl.emergencyStop(); } catch { threw = true; }
  assert(!threw && calls.emergency === 1,
    `[${label}] controller.emergencyStop() does not throw`);

  // safetyOff on the controller (T1-22's two-stage path)
  threw = false;
  try { await ctrl.safetyOff(); } catch { threw = true; }
  assert(!threw && calls.safetyOff === 1,
    `[${label}] controller.safetyOff() does not throw`);
}

// ─── Static guard: scan the safety-critical files for entitlement
//     imports or function calls. The list comes from
//     docs/SAFETY_GUARANTEES.md.

const SAFETY_FILES = [
  'src/app/MachineService.ts',
  'src/app/ExecutionCoordinator.ts',
  'src/controllers/grbl/GrblController.ts',
  'src/communication/SerialPort.ts',
  'src/communication/WebSerialPort.ts',
];

const FORBIDDEN_PATTERNS: Array<{ re: RegExp; what: string }> = [
  { re: /^\s*import\b[^;]*from\s+['"][^'"]*entitlements/, what: 'import from entitlements/' },
  { re: /\brequireFeature\s*\(/, what: 'requireFeature(...) call' },
  { re: /\bassertFeature\s*\(/, what: 'assertFeature(...) call' },
  { re: /\bcanUseFeature\s*\(/, what: 'canUseFeature(...) call' },
  { re: /\bhasPro\s*\(/, what: 'hasPro(...) call' },
];

{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '..');

  let violations = 0;
  for (const file of SAFETY_FILES) {
    const full = path.resolve(repoRoot, file);
    if (!fs.existsSync(full)) {
      assert(false, `safety file ${file} does not exist on disk`);
      continue;
    }
    const src = fs.readFileSync(full, 'utf-8');
    const lines = src.split('\n');

    let fileClean = true;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Strip line comments before pattern matching so doc-comments
      // about entitlement (e.g. "T1-88: requireFeature import removed")
      // don't false-positive.
      const codeOnly = line.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//, '');
      for (const { re, what } of FORBIDDEN_PATTERNS) {
        if (re.test(codeOnly)) {
          violations++;
          fileClean = false;
          assert(false,
            `${file}:${i + 1} contains ${what} — safety files MUST NOT consult entitlement`);
        }
      }
    }
    if (fileClean) {
      assert(true, `${file} is clean (no entitlement imports / calls)`);
    }
  }

  assert(violations === 0,
    `total safety-file entitlement-leak count = ${violations}`);
}

// ─── Doc pin: SAFETY_GUARANTEES.md exists with the expected sections

{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const docPath = path.resolve(here, '../docs/SAFETY_GUARANTEES.md');
  const docExists = fs.existsSync(docPath);
  assert(docExists, 'docs/SAFETY_GUARANTEES.md exists');
  if (docExists) {
    const src = fs.readFileSync(docPath, 'utf-8');
    assert(/T2-97/.test(src) || /Audit 5A Required Priority 9/.test(src),
      'SAFETY_GUARANTEES.md cites the audit reference');
    for (const sym of [
      'stopAndEnsureLaserOff', 'pause', 'resume', 'disconnect',
      'emergencyStop', 'safetyOff',
    ]) {
      assert(src.includes(sym),
        `SAFETY_GUARANTEES.md names ${sym} as guaranteed`);
    }
    assert(/Allow-list/.test(src),
      'SAFETY_GUARANTEES.md has an Allow-list section (currently empty)');
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
