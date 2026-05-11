/**
 * T1-171 (audit F-014): the auto-M5-on-connect onStateChange listener
 * registered by `MachineService._armAutoM5OnConnect` must be torn
 * down on `disconnect()` and `emergencyStop()` so it doesn't leak
 * when the controller is force-disconnected before reaching 'idle'.
 *
 * Pre-T1-171: the listener auto-unsubscribed only when status reached
 * 'idle'. If a connect cycle ended before idle (e.g., port pulled,
 * handshake failure), the listener's closure was left attached to the
 * controller's _stateListeners. Repeated failed-connect cycles
 * accumulated one closure per cycle — low absolute impact, but real
 * memory pressure over a long session of flaky USB.
 *
 * Post-T1-171:
 *  - `_armAutoM5OnConnect` stashes the registered `unsubscribe` on
 *    `this._autoM5Unsubscribe`.
 *  - `_clearAutoM5Listener` reads + clears that field and calls the
 *    unsubscribe if non-null.
 *  - `disconnect()` and `emergencyStop()` both call
 *    `_clearAutoM5Listener` in their finally clause.
 *  - `_armAutoM5OnConnect` also calls `_clearAutoM5Listener` at entry
 *    to defensively handle re-arm-without-disconnect (not a supported
 *    flow but a cheap safety net).
 *
 * Run: npx tsx tests/auto-m5-listener-cleared-on-disconnect.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MachineService } from '../src/app/MachineService';
import {
  createBlankProfile,
  saveDeviceProfile,
  setActiveProfileId,
} from '../src/core/devices/DeviceProfile';
import { setStorageForTest } from '../src/core/storage/storage';
import { InMemoryStorageAdapter } from '../src/core/storage/InMemoryStorageAdapter';
import {
  type LaserController,
  type MachineState,
  type StateChangeCallback,
} from '../src/controllers/ControllerInterface';
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

/**
 * Mock controller that tracks attached state listeners so the test
 * can prove they're actually unsubscribed on cleanup.
 */
function makeController(): {
  controller: LaserController;
  attachedListeners: Set<StateChangeCallback>;
} {
  const attachedListeners = new Set<StateChangeCallback>();
  const controller = {
    protocolName: 'mock',
    state: { ...idle, status: 'connecting' },
    isJobRunning: false,
    maxSpindle: null,
    connect: async () => {},
    disconnect: async () => {},
    sendJob: async () => {},
    pause: () => {},
    resume: () => {},
    stop: () => {},
    emergencyStop: () => {},
    sendCommand: () => {},
    requestStatusReport: () => {},
    onStateChange: (cb: StateChangeCallback) => {
      attachedListeners.add(cb);
      return () => {
        attachedListeners.delete(cb);
      };
    },
    onProgress: () => () => {},
    onError: () => () => {},
    onRawLine: () => () => {},
    safetyOff: async () => ({ stage: 'm5' as const }),
    getUnsafeAtConnect: () => null, // clean verdict — auto-M5 is armed
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
      emergencyStop: async () => ({ ok: true }),
    },
  } as unknown as LaserController;
  return { controller, attachedListeners };
}

function buildService(ctrl: LaserController): MachineService {
  const portRef: { current: SerialPortLike | null } = { current: null };
  return new MachineService({ current: ctrl }, portRef);
}

function arm(svc: MachineService): void {
  (svc as unknown as { _armAutoM5OnConnect: () => void })._armAutoM5OnConnect();
}

function setupProfile(autoM5OnConnect: boolean): void {
  setStorageForTest(new InMemoryStorageAdapter());
  const profile = createBlankProfile('T1-171-test');
  profile.autoM5OnConnect = autoM5OnConnect;
  saveDeviceProfile(profile);
  setActiveProfileId(profile.id);
}

console.log('\n=== T1-171 auto-M5 listener cleared on disconnect / emergencyStop ===\n');

void (async () => {
  // -------- 1. disconnect clears an armed but never-fired listener --------
  {
    setupProfile(true);
    const { controller, attachedListeners } = makeController();
    const svc = buildService(controller);
    arm(svc);
    assert(
      attachedListeners.size === 1,
      `pre: 1 listener attached after _armAutoM5OnConnect (got ${attachedListeners.size})`,
    );

    await svc.disconnect();
    assert(
      attachedListeners.size === 0,
      `disconnect: listener cleared by _clearAutoM5Listener (got ${attachedListeners.size})`,
    );
  }

  // -------- 2. emergencyStop clears an armed but never-fired listener --------
  {
    setupProfile(true);
    const { controller, attachedListeners } = makeController();
    const svc = buildService(controller);
    arm(svc);
    assert(
      attachedListeners.size === 1,
      `pre (emergencyStop): 1 listener attached after _armAutoM5OnConnect (got ${attachedListeners.size})`,
    );

    await svc.emergencyStop();
    assert(
      attachedListeners.size === 0,
      `emergencyStop: listener cleared by _clearAutoM5Listener (got ${attachedListeners.size})`,
    );
  }

  // -------- 3. Re-arm calls _clearAutoM5Listener defensively --------
  {
    setupProfile(true);
    const { controller, attachedListeners } = makeController();
    const svc = buildService(controller);
    arm(svc);
    assert(attachedListeners.size === 1, 're-arm pre: 1 listener attached');

    // Re-arm without disconnect: the prior listener should be torn
    // down before the new one attaches, so exactly 1 stays attached.
    arm(svc);
    assert(
      attachedListeners.size === 1,
      `re-arm: still exactly 1 listener (prior was torn down). Got ${attachedListeners.size}`,
    );
  }

  // -------- 4. After listener fires naturally (status === idle), _autoM5Unsubscribe is cleared --------
  {
    setupProfile(true);
    const { controller, attachedListeners } = makeController();
    const svc = buildService(controller);
    arm(svc);
    assert(attachedListeners.size === 1, 'fire path pre: 1 listener attached');

    // Simulate the controller reaching idle by invoking the captured
    // callback directly. The listener fires once, unsubscribes itself,
    // and clears `_autoM5Unsubscribe`.
    const cb = [...attachedListeners][0];
    cb({ ...idle });
    assert(
      attachedListeners.size === 0,
      `fire path: listener auto-unsubscribed on idle (got ${attachedListeners.size})`,
    );

    // After fire, _autoM5Unsubscribe should be cleared. Calling
    // disconnect should be a no-op for the listener (still cleared).
    const stash = (svc as unknown as { _autoM5Unsubscribe: (() => void) | null })._autoM5Unsubscribe;
    assert(stash === null, 'fire path: _autoM5Unsubscribe stash is null after natural fire');

    await svc.disconnect();
    assert(
      attachedListeners.size === 0,
      'disconnect after fire: still zero listeners (cleanup is idempotent)',
    );
  }

  // -------- 5. Opt-out path: nothing armed, nothing to clear --------
  {
    setupProfile(false); // autoM5OnConnect = false
    const { controller, attachedListeners } = makeController();
    const svc = buildService(controller);
    arm(svc);
    assert(
      attachedListeners.size === 0,
      `opt-out: _armAutoM5OnConnect early-returns; no listener attached (got ${attachedListeners.size})`,
    );

    await svc.disconnect();
    assert(attachedListeners.size === 0, 'opt-out: disconnect still leaves zero listeners');
  }

  // -------- 6. Source pins on the field + method --------
  {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, '../src/app/MachineService.ts'), 'utf-8');
    assert(/T1-171/.test(src), 'MachineService.ts carries T1-171 marker');
    assert(/audit F-014/.test(src), 'MachineService.ts cross-references audit F-014');

    // Field declaration.
    assert(
      /_autoM5Unsubscribe:\s*\(\(\)\s*=>\s*void\)\s*\|\s*null/.test(src),
      '_autoM5Unsubscribe field declared with the right type',
    );

    // Cleanup method.
    assert(
      /private _clearAutoM5Listener\(\)/.test(src),
      '_clearAutoM5Listener method declared',
    );

    // disconnect / emergencyStop call it.
    const callsToCleanup = src.match(/this\._clearAutoM5Listener\(\)/g);
    assert(
      callsToCleanup !== null && callsToCleanup.length >= 3,
      `_clearAutoM5Listener invoked at least 3 times (arm-entry, disconnect, emergencyStop). Got ${callsToCleanup?.length ?? 0}`,
    );

    // The field is stashed inside _armAutoM5OnConnect.
    assert(
      /this\._autoM5Unsubscribe\s*=\s*unsubscribe;/.test(src),
      '_armAutoM5OnConnect stashes the unsubscribe handle',
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
