/**
 * T1-50 Part B: `MachineService.connectRealLaser` accepts an optional
 * AbortSignal. Pre-aborted signals throw immediately; signals aborted
 * during the connect routine throw at the next await boundary and
 * route through the T1-49 cleanup path (port closed, portRef nulled,
 * controller.disconnect best-effort called).
 *
 * Follow-up slices now pass the same UI-owned signal through
 * `WebSerialPort.requestAndOpen` and `GrblController.connect`, so
 * cancel covers port selection/open and the GRBL welcome handshake.
 *
 * Hardware verification: not required (UI plumbing for previously-
 * swallowed async failures, no g-code or machine-state change).
 *
 * Run: npx tsx tests/connect-abort-signal.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
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
  lastConnectSignal: AbortSignal | undefined;
  setConnectImpl: (impl: () => Promise<void>) => void;
}

function makeControllerSpy(): ControllerSpy {
  let connectImpl: () => Promise<void> = async () => {};
  const spy: ControllerSpy = {
    connectCalls: 0,
    disconnectCalls: 0,
    lastConnectSignal: undefined,
    setConnectImpl: (impl) => { connectImpl = impl; },
    controller: {
      protocolName: 'mock',
      state: idle,
      isJobRunning: false,
      maxSpindle: null,
      connect: async (_port: SerialPortLike, signal?: AbortSignal) => {
        spy.connectCalls += 1;
        spy.lastConnectSignal = signal;
        await connectImpl();
      },
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
    } as unknown as LaserController,
  };
  return spy;
}

interface PortSpy {
  closeCalls: number;
}

function isAbortError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return e.name === 'AbortError'
    || /aborted/i.test(e.message);
}

void (async () => {
  console.log('\n=== T1-50 Part B abortable connect (interface stub) ===\n');
  const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
  const machineServiceSource = fs.readFileSync(path.join(repoRoot, 'src', 'app', 'MachineService.ts'), 'utf8');

  const origIsSupported = WebSerialPort.isSupported;
  const origRequestAndOpen = (WebSerialPort.prototype as unknown as {
    requestAndOpen: (b: number, s?: AbortSignal) => Promise<void>;
  }).requestAndOpen;
  const origClose = WebSerialPort.prototype.close;

  let currentRequestAndOpenImpl: (this: WebSerialPort, b: number, s?: AbortSignal) => Promise<void>
    = async function () {};
  let lastRequestAndOpenSignal: AbortSignal | undefined;
  let lastPortSpy: PortSpy | null = null;

  (WebSerialPort as unknown as { isSupported: () => boolean }).isSupported = () => true;
  (WebSerialPort.prototype as unknown as {
    requestAndOpen: (b: number, s?: AbortSignal) => Promise<void>;
  }).requestAndOpen = function (this: WebSerialPort, b: number, s?: AbortSignal): Promise<void> {
    lastRequestAndOpenSignal = s;
    return currentRequestAndOpenImpl.call(this, b, s);
  };
  // T2-31: close is now async on the SerialPortLike interface; the test
  // stub mirrors that signature so the prototype patch type-checks.
  WebSerialPort.prototype.close = async function (this: WebSerialPort): Promise<void> {
    if (lastPortSpy) lastPortSpy.closeCalls += 1;
  };

  try {
    // ── 1. Pre-aborted signal: throw immediately, no port allocation ──
    {
      const ctrl = makeControllerSpy();
      const portRef = { current: null } as { current: SerialPortLike | null };
      const svc = new MachineService(
        { current: ctrl.controller } as { current: LaserController },
        portRef,
      );
      const portSpy: PortSpy = { closeCalls: 0 };
      lastPortSpy = portSpy;

      const ac = new AbortController();
      ac.abort(new Error('user cancelled'));

      let caught: unknown = null;
      try {
        await svc.connectRealLaser(115200, ac.signal);
      } catch (e) { caught = e; }

      assert(isAbortError(caught) || (caught instanceof Error && /cancelled/i.test(caught.message)),
        'pre-aborted: throws an abort-shaped error');
      assert(portRef.current === null, 'pre-aborted: portRef stays null');
      assert(portSpy.closeCalls === 0, 'pre-aborted: no port was created, close NOT called');
      assert(ctrl.connectCalls === 0, 'pre-aborted: controller.connect NOT called');
      assert(ctrl.disconnectCalls === 0,
        'pre-aborted: controller.disconnect NOT called (no partial state to clean)');
    }

    // ── 2. Aborted between requestAndOpen and controller.connect ──
    {
      const ctrl = makeControllerSpy();
      const portRef = { current: null } as { current: SerialPortLike | null };
      const svc = new MachineService(
        { current: ctrl.controller } as { current: LaserController },
        portRef,
      );
      const portSpy: PortSpy = { closeCalls: 0 };
      lastPortSpy = portSpy;

      const ac = new AbortController();
      // Abort during requestAndOpen so the throwIfAborted at the post-open
      // hook fires before controller.connect is reached.
      currentRequestAndOpenImpl = async () => {
        ac.abort(new Error('user cancelled mid-open'));
      };

      let caught: unknown = null;
      try {
        await svc.connectRealLaser(115200, ac.signal);
      } catch (e) { caught = e; }

      assert(isAbortError(caught) || (caught instanceof Error && /cancelled/i.test(caught.message)),
        'abort-mid-open: throws an abort-shaped error');
      assert(portRef.current === null, 'abort-mid-open: portRef stays null');
      assert(portSpy.closeCalls === 1,
        'abort-mid-open: T1-49 cleanup ran (port.close called)');
      assert(ctrl.connectCalls === 0,
        'abort-mid-open: controller.connect NOT called (throw fired between)');
      assert(ctrl.disconnectCalls === 1,
        'abort-mid-open: T1-49 cleanup called controller.disconnect');
    }

    // ── 3. Aborted between controller.connect and portRef assignment ──
    {
      const ctrl = makeControllerSpy();
      const portRef = { current: null } as { current: SerialPortLike | null };
      const svc = new MachineService(
        { current: ctrl.controller } as { current: LaserController },
        portRef,
      );
      const portSpy: PortSpy = { closeCalls: 0 };
      lastPortSpy = portSpy;

      const ac = new AbortController();
      currentRequestAndOpenImpl = async () => {};
      ctrl.setConnectImpl(async () => {
        // Abort during controller.connect — the throwIfAborted at the
        // post-connect hook fires before portRef gets assigned.
        ac.abort(new Error('user cancelled mid-connect'));
      });

      let caught: unknown = null;
      try {
        await svc.connectRealLaser(115200, ac.signal);
      } catch (e) { caught = e; }

      assert(isAbortError(caught) || (caught instanceof Error && /cancelled/i.test(caught.message)),
        'abort-mid-connect: throws an abort-shaped error');
      assert(portRef.current === null,
        'abort-mid-connect: portRef stays null (throw fired before assignment)');
      assert(portSpy.closeCalls === 1,
        'abort-mid-connect: T1-49 cleanup ran (port.close called)');
      assert(ctrl.connectCalls === 1,
        'abort-mid-connect: controller.connect was attempted before throw');
      assert(ctrl.disconnectCalls === 1,
        'abort-mid-connect: T1-49 cleanup called controller.disconnect');
    }

    // ── 4. No signal passed → behavior identical to T1-49 happy path ──
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

      assert(portRef.current !== null,
        'no signal: portRef points at the WebSerialPort (production-path equivalence)');
      assert(portSpy.closeCalls === 0, 'no signal: port.close NOT called');
      assert(ctrl.disconnectCalls === 0, 'no signal: controller.disconnect NOT called');
    }

    // ── 5. Signal that never aborts → behaves like no signal ───
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

      const ac = new AbortController();
      await svc.connectRealLaser(115200, ac.signal);

      assert(portRef.current !== null,
        'unaborted signal: portRef points at the WebSerialPort (no behavior change)');
      assert(lastRequestAndOpenSignal === ac.signal,
        'unaborted signal: MachineService passes signal to WebSerialPort.requestAndOpen');
      assert(ctrl.lastConnectSignal === ac.signal,
        'unaborted signal: MachineService passes signal to controller.connect');
      assert(portSpy.closeCalls === 0, 'unaborted signal: port.close NOT called');
      assert(ctrl.disconnectCalls === 0,
        'unaborted signal: controller.disconnect NOT called');
    }

    assert(/requestAndOpen\(baudRate,\s*signal\)/.test(machineServiceSource),
      'source pin: MachineService passes AbortSignal into WebSerialPort.requestAndOpen');
    assert(/controllerRef\.current\.connect\(ws,\s*signal\)/.test(machineServiceSource),
      'source pin: MachineService passes AbortSignal into controller.connect');
  } finally {
    (WebSerialPort as unknown as { isSupported: () => boolean }).isSupported = origIsSupported;
    (WebSerialPort.prototype as unknown as {
      requestAndOpen: (b: number, s?: AbortSignal) => Promise<void>;
    }).requestAndOpen = origRequestAndOpen;
    WebSerialPort.prototype.close = origClose;
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
