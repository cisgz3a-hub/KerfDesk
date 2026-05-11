/**
 * T1-169 (audit F-013): `MachineService.disconnect` and
 * `MachineService.emergencyStop` must compare-and-swap `portRef.current`
 * — capture the port at entry and only null it if the finally clause
 * still sees the same reference.
 *
 * Pre-T1-169 both methods did an unconditional `this.portRef.current
 * = null;` in their finally clause. A rapid disconnect → connect
 * race (or emergencyStop → connect) could leave the finally nulling
 * out the new port reference that a fresh connect had just installed.
 * `connectRealLaser` already used this compare-and-swap pattern at
 * line 1520 (`if (this.portRef.current === ws) { this.portRef.current
 * = null; }`); disconnect / emergencyStop now follow suit.
 *
 * The audit (docs/AUDIT-2026-05-11.md F-013) flagged this as
 * Low-severity robustness. The window is narrow but pathological
 * async ordering (especially combined with F-002 stale-callback race)
 * could produce a "fresh connect immediately nulled" outcome.
 *
 * Run: npx tsx tests/disconnect-emergency-portref-compare-and-swap.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MachineService } from '../src/app/MachineService';
import { type LaserController, type MachineState } from '../src/controllers/ControllerInterface';
import { type SerialPortLike } from '../src/communication/SerialPort';

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

const idle: MachineState = {
  status: 'idle',
  position: { x: 0, y: 0, z: 0 },
  feedRate: 0,
  spindleSpeed: 0,
  alarmCode: null,
  errorCode: null,
};

function makeController(opts?: {
  disconnectHook?: () => Promise<void>;
  emergencyStopHook?: () => Promise<void>;
}): LaserController {
  return {
    protocolName: 'mock',
    state: { ...idle },
    isJobRunning: false,
    maxSpindle: null,
    connect: async () => {},
    disconnect: async () => {
      if (opts?.disconnectHook) await opts.disconnectHook();
    },
    sendJob: async () => {},
    pause: () => {},
    resume: () => {},
    stop: () => {},
    emergencyStop: () => {},
    sendCommand: () => {},
    requestStatusReport: () => {},
    onStateChange: () => () => {},
    onProgress: () => () => {},
    onError: () => () => {},
    onRawLine: () => () => {},
    safetyOff: async () => ({ stage: 'm5' as const }),
    operations: {
      jog: async () => ({ ok: true }),
      home: async () => ({ ok: true }),
      unlockAlarm: async () => ({ ok: true }),
      setWorkOriginAtCurrentPosition: async () => ({ ok: true }),
      resetWcsToMachineOrigin: async () => ({ ok: true }),
      laserOff: async () => ({ ok: true }),
      pauseJob: async () => ({ ok: true }),
      resumeJob: async () => ({ ok: true }),
      stopJob: async () => ({ ok: true }),
      emergencyStop: async () => {
        if (opts?.emergencyStopHook) await opts.emergencyStopHook();
        return { ok: true };
      },
    },
  } as unknown as LaserController;
}

console.log('\n=== T1-169 portRef compare-and-swap in disconnect / emergencyStop ===\n');

void (async () => {
  // -------- 1. disconnect: when portRef is unchanged, it gets nulled (regression bait) --------
  {
    const port: SerialPortLike = {} as SerialPortLike;
    const ctrl = makeController();
    const portRef: { current: SerialPortLike | null } = { current: port };
    const svc = new MachineService({ current: ctrl }, portRef);
    await svc.disconnect();
    assert(
      portRef.current === null,
      'disconnect: when port reference is unchanged during the call, finally nulls it (existing behavior preserved)',
    );
  }

  // -------- 2. disconnect: when portRef is replaced mid-call, finally does NOT null the new port --------
  {
    const originalPort: SerialPortLike = { __id: 'original' } as unknown as SerialPortLike;
    const freshPort: SerialPortLike = { __id: 'fresh-from-racing-connect' } as unknown as SerialPortLike;
    const portRef: { current: SerialPortLike | null } = { current: originalPort };

    // Mid-call: simulate a racing connect that swaps in a new port
    // before disconnect's finally clause fires. The controller's
    // disconnect() hook runs inside the try; right after, the finally
    // executes — so we mutate portRef from the disconnect hook.
    const ctrl = makeController({
      disconnectHook: async () => {
        portRef.current = freshPort;
      },
    });
    const svc = new MachineService({ current: ctrl }, portRef);
    await svc.disconnect();

    assert(
      portRef.current === freshPort,
      'disconnect: when a fresh port reference replaced the captured port during the call, finally LEAVES the fresh port intact',
    );
  }

  // -------- 3. emergencyStop: same regression bait — unchanged port gets nulled --------
  {
    const port: SerialPortLike = {} as SerialPortLike;
    const ctrl = makeController();
    const portRef: { current: SerialPortLike | null } = { current: port };
    const svc = new MachineService({ current: ctrl }, portRef);
    await svc.emergencyStop();
    assert(
      portRef.current === null,
      'emergencyStop: when port reference is unchanged, finally nulls it (existing behavior preserved)',
    );
  }

  // -------- 4. emergencyStop: portRef replaced mid-call is NOT nulled --------
  {
    const originalPort: SerialPortLike = { __id: 'original-e' } as unknown as SerialPortLike;
    const freshPort: SerialPortLike = { __id: 'fresh-after-e-stop' } as unknown as SerialPortLike;
    const portRef: { current: SerialPortLike | null } = { current: originalPort };

    const ctrl = makeController({
      emergencyStopHook: async () => {
        portRef.current = freshPort;
      },
    });
    const svc = new MachineService({ current: ctrl }, portRef);
    await svc.emergencyStop();

    assert(
      portRef.current === freshPort,
      'emergencyStop: when a fresh port reference replaced the captured port, finally LEAVES the fresh port intact',
    );
  }

  // -------- 5. Source pins on the compare-and-swap implementation --------
  {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, '../src/app/MachineService.ts'), 'utf-8');

    assert(/T1-169/.test(src), 'MachineService.ts carries T1-169 marker');
    assert(/audit F-013/.test(src), 'MachineService.ts cross-references audit F-013');

    // The disconnect-time captured-port pattern.
    assert(
      /async disconnect\([\s\S]{0,1500}const port = this\.portRef\.current;/.test(src),
      'disconnect() captures `const port = this.portRef.current` at entry',
    );

    // The emergencyStop-time captured-port pattern.
    assert(
      /async emergencyStop\([\s\S]{0,500}const port = this\.portRef\.current;/.test(src),
      'emergencyStop() captures `const port = this.portRef.current` at entry',
    );

    // The compare-and-swap clause appears in both finally blocks.
    const cas = src.match(/if \(this\.portRef\.current === port\) \{\s*this\.portRef\.current = null;\s*\}/g);
    assert(
      cas !== null && cas.length === 2,
      `compare-and-swap pattern appears exactly twice (got ${cas?.length ?? 0}: one for disconnect, one for emergencyStop)`,
    );

    // The unconditional null assignment in disconnect/emergencyStop is gone.
    // The pre-T1-169 line was a bare `this.portRef.current = null;` in
    // the finally clauses. We check this indirectly: in the disconnect
    // / emergencyStop bodies, the only `this.portRef.current = null`
    // must be inside the compare-and-swap guard.
    const disconnectBody = src.match(/async disconnect\(\)[\s\S]*?\n  \}/);
    const emergencyBody = src.match(/async emergencyStop\(\)[\s\S]*?\n  \}/);
    assert(
      disconnectBody !== null,
      'disconnect body extracted for inspection',
    );
    assert(
      emergencyBody !== null,
      'emergencyStop body extracted for inspection',
    );
    if (disconnectBody) {
      const matches = disconnectBody[0].match(/this\.portRef\.current = null/g);
      assert(
        matches !== null && matches.length === 1,
        `disconnect: portRef nulling appears exactly once (inside the CAS guard); got ${matches?.length ?? 0}`,
      );
    }
    if (emergencyBody) {
      const matches = emergencyBody[0].match(/this\.portRef\.current = null/g);
      assert(
        matches !== null && matches.length === 1,
        `emergencyStop: portRef nulling appears exactly once (inside the CAS guard); got ${matches?.length ?? 0}`,
      );
    }
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
