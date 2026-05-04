/**
 * T1-49: `MachineService.connectRealLaser` must clean up on partial
 * failure. Previously `portRef.current = ws` was assigned BEFORE
 * `requestAndOpen` and `controller.connect`. A throw on either left a
 * half-open WebSerialPort pinned on portRef; subsequent
 * `portRef.current != null` checks treated the app as connected and
 * reconnect often failed until app reload.
 *
 * Now: portRef is assigned only on full success. On any thrown
 * failure, the port is closed (sync today, async after T2-31), portRef
 * is nulled if it ended up pointing at the failed port, and the
 * controller is best-effort disconnected to release any partial-connect
 * state. The original error propagates to the caller.
 *
 * Hardware verification: not required (UI plumbing for previously-
 * swallowed async failures, no g-code or machine-state change).
 *
 * Run: npx tsx tests/connect-cleanup-on-partial-failure.test.ts
 */
import { MachineService } from '../src/app/MachineService';
import {
  type LaserController,
  type MachineState,
} from '../src/controllers/ControllerInterface';
import { type SerialPortLike } from '../src/communication/SerialPort';
import { WebSerialPort } from '../src/communication/WebSerialPort';

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

const idle: MachineState = {
  status: 'idle',
  position: { x: 0, y: 0, z: 0 },
  feedRate: 0,
  spindleSpeed: 0,
  alarmCode: null,
  errorCode: null,
};

interface ControllerSpy {
  controller: LaserController;
  connectCalls: number;
  disconnectCalls: number;
  setConnectImpl: (impl: () => Promise<void>) => void;
}

function makeControllerSpy(): ControllerSpy {
  let connectImpl: () => Promise<void> = async () => {};
  const spy: ControllerSpy = {
    connectCalls: 0,
    disconnectCalls: 0,
    setConnectImpl: (impl) => { connectImpl = impl; },
    controller: {
      protocolName: 'mock',
      state: idle,
      isJobRunning: false,
      maxSpindle: null,
      connect: async () => { spy.connectCalls += 1; await connectImpl(); },
      disconnect: async () => { spy.disconnectCalls += 1; },
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
    } as LaserController,
  };
  return spy;
}

interface PortSpy {
  closeCalls: number;
}

void (async () => {
  console.log('\n=== T1-49 connect cleanup on partial failure ===\n');

  // Stub the WebSerialPort surface so the connectRealLaser path can run
  // under jsdom / Node where `navigator.serial` doesn't exist. We patch:
  //   - `isSupported` → true (otherwise we'd throw before the try block)
  //   - `requestAndOpen` → instance-controlled (per-test impl)
  //   - `close` → records calls so we can assert cleanup
  const origIsSupported = WebSerialPort.isSupported;
  const origRequestAndOpen = (WebSerialPort.prototype as unknown as {
    requestAndOpen: (b: number) => Promise<void>;
  }).requestAndOpen;
  const origClose = WebSerialPort.prototype.close;

  let currentRequestAndOpenImpl: (this: WebSerialPort, b: number) => Promise<void>
    = async function () { /* default: succeed */ };
  let lastPortSpy: PortSpy | null = null;

  (WebSerialPort as unknown as { isSupported: () => boolean }).isSupported = () => true;
  (WebSerialPort.prototype as unknown as {
    requestAndOpen: (b: number) => Promise<void>;
  }).requestAndOpen = function (this: WebSerialPort, b: number): Promise<void> {
    return currentRequestAndOpenImpl.call(this, b);
  };
  WebSerialPort.prototype.close = function (this: WebSerialPort): void {
    if (lastPortSpy) lastPortSpy.closeCalls += 1;
    // Don't call origClose — it touches navigator.serial internals that
    // aren't present here. We're only testing the cleanup CALL itself.
  };

  try {
    // ── 1. requestAndOpen throws → cleanup ─────────────────────────
    {
      const ctrl = makeControllerSpy();
      const portRef = { current: null } as { current: SerialPortLike | null };
      const svc = new MachineService(
        { current: ctrl.controller } as { current: LaserController },
        portRef,
      );
      const portSpy: PortSpy = { closeCalls: 0 };
      lastPortSpy = portSpy;
      currentRequestAndOpenImpl = async () => { throw new Error('permission denied'); };

      let caught: unknown = null;
      try {
        await svc.connectRealLaser(115200);
      } catch (e) {
        caught = e;
      }

      assert(caught instanceof Error && /permission denied/.test((caught as Error).message),
        'requestAndOpen throw: original error propagates to caller');
      assert(portRef.current === null,
        'requestAndOpen throw: portRef.current is null after failure');
      assert(portSpy.closeCalls === 1,
        'requestAndOpen throw: port.close() was called exactly once');
      assert(ctrl.connectCalls === 0,
        'requestAndOpen throw: controller.connect was NOT called (open failed first)');
      assert(ctrl.disconnectCalls === 1,
        'requestAndOpen throw: controller.disconnect was called for cleanup');
    }

    // ── 2. controller.connect throws → cleanup ────────────────────
    {
      const ctrl = makeControllerSpy();
      const portRef = { current: null } as { current: SerialPortLike | null };
      const svc = new MachineService(
        { current: ctrl.controller } as { current: LaserController },
        portRef,
      );
      const portSpy: PortSpy = { closeCalls: 0 };
      lastPortSpy = portSpy;
      currentRequestAndOpenImpl = async () => { /* open succeeds */ };
      ctrl.setConnectImpl(async () => { throw new Error('handshake timeout'); });

      let caught: unknown = null;
      try {
        await svc.connectRealLaser(115200);
      } catch (e) {
        caught = e;
      }

      assert(caught instanceof Error && /handshake timeout/.test((caught as Error).message),
        'connect throw: original error propagates to caller');
      assert(portRef.current === null,
        'connect throw: portRef.current is null after failure (was never assigned)');
      assert(portSpy.closeCalls === 1,
        'connect throw: port.close() was called exactly once');
      assert(ctrl.connectCalls === 1,
        'connect throw: controller.connect was attempted before failure');
      assert(ctrl.disconnectCalls === 1,
        'connect throw: controller.disconnect was called for cleanup');
    }

    // ── 3. happy path: portRef set on full success ───────────────
    {
      const ctrl = makeControllerSpy();
      const portRef = { current: null } as { current: SerialPortLike | null };
      const svc = new MachineService(
        { current: ctrl.controller } as { current: LaserController },
        portRef,
      );
      const portSpy: PortSpy = { closeCalls: 0 };
      lastPortSpy = portSpy;
      currentRequestAndOpenImpl = async () => {};
      ctrl.setConnectImpl(async () => {});

      await svc.connectRealLaser(115200);

      assert(portRef.current !== null && portRef.current instanceof WebSerialPort,
        'happy path: portRef.current points at the WebSerialPort instance');
      assert(portSpy.closeCalls === 0,
        'happy path: port.close() was NOT called');
      assert(ctrl.disconnectCalls === 0,
        'happy path: controller.disconnect was NOT called');
    }

    // ── 4. Web Serial unsupported → throw before any port allocation ─
    {
      (WebSerialPort as unknown as { isSupported: () => boolean }).isSupported = () => false;
      const ctrl = makeControllerSpy();
      const portRef = { current: null } as { current: SerialPortLike | null };
      const svc = new MachineService(
        { current: ctrl.controller } as { current: LaserController },
        portRef,
      );
      let caught: unknown = null;
      try {
        await svc.connectRealLaser(115200);
      } catch (e) {
        caught = e;
      }
      assert(caught instanceof Error && /not supported/i.test((caught as Error).message),
        'unsupported browser: throws "Web Serial not supported"');
      assert(portRef.current === null,
        'unsupported browser: portRef.current stays null');
      assert(ctrl.disconnectCalls === 0,
        'unsupported browser: controller.disconnect NOT called (no partial state to clean)');
      // Restore for any subsequent block.
      (WebSerialPort as unknown as { isSupported: () => boolean }).isSupported = () => true;
    }
  } finally {
    (WebSerialPort as unknown as { isSupported: () => boolean }).isSupported = origIsSupported;
    (WebSerialPort.prototype as unknown as {
      requestAndOpen: (b: number) => Promise<void>;
    }).requestAndOpen = origRequestAndOpen;
    WebSerialPort.prototype.close = origClose;
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
