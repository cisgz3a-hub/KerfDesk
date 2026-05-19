/**
 * T3-48 follow-up: the real MachineService USB connect path must consume
 * WebSerialPort.connectKnownPortOrPrompt instead of the old prompt-only
 * requestAndOpen path. The lower-level WebSerial adapter already knows how
 * to reuse navigator.serial.getPorts(); this pins the production caller.
 *
 * Run: npx tsx tests/machine-service-known-port-reuse.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { MachineService } from '../src/app/MachineService';
import { type SerialPortLike } from '../src/communication/SerialPort';
import {
  WebSerialPort,
  type DeviceFingerprint,
  type KnownPortConnectResult,
} from '../src/communication/WebSerialPort';
import {
  createBlankProfile,
  getActiveProfile,
  resetDeviceProfilesForTest,
  saveDeviceProfile,
  setActiveProfileId,
  type DeviceProfile,
} from '../src/core/devices/DeviceProfile';
import {
  type LaserController,
  type MachineState,
} from '../src/controllers/ControllerInterface';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  OK ${m}`);
  } else {
    failed++;
    console.error(`  FAIL ${m}`);
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
  lastPort: SerialPortLike | null;
  lastSignal: AbortSignal | undefined;
}

function makeControllerSpy(): ControllerSpy {
  const spy: ControllerSpy = {
    connectCalls: 0,
    lastPort: null,
    lastSignal: undefined,
    controller: {
      protocolName: 'mock',
      state: idle,
      isJobRunning: false,
      maxSpindle: null,
      connect: async (port: SerialPortLike, signal?: AbortSignal) => {
        spy.connectCalls += 1;
        spy.lastPort = port;
        spy.lastSignal = signal;
      },
      disconnect: async () => {},
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

function setActiveSerialProfile(
  overrides: Partial<DeviceProfile> & {
    connection?: DeviceProfile['connection'];
  } = {},
): DeviceProfile {
  resetDeviceProfilesForTest();
  const profile: DeviceProfile = {
    ...createBlankProfile('Known USB profile'),
    ...overrides,
  };
  saveDeviceProfile(profile);
  setActiveProfileId(profile.id);
  return profile;
}

void (async () => {
  console.log('\n=== T3-48 MachineService known-port reuse wiring ===\n');

  const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
  const machineServiceSource = fs.readFileSync(path.join(repoRoot, 'src', 'app', 'MachineService.ts'), 'utf8');
  const profileSource = fs.readFileSync(path.join(repoRoot, 'src', 'core', 'devices', 'DeviceProfile.ts'), 'utf8');

  const origIsSupported = WebSerialPort.isSupported;
  const origRequestAndOpen = WebSerialPort.prototype.requestAndOpen;
  const origConnectKnown = WebSerialPort.prototype.connectKnownPortOrPrompt;
  const origClose = WebSerialPort.prototype.close;

  let connectKnownCalls = 0;
  let requestAndOpenCalls = 0;
  let lastBaudRate: number | undefined;
  let lastFingerprint: DeviceFingerprint | undefined;
  let lastConnectSignal: AbortSignal | undefined;
  let nextResult: KnownPortConnectResult = {
    usedKnownPort: true,
    fingerprint: { usbVendorId: 0x1a86, usbProductId: 0x7523 },
  };

  (WebSerialPort as unknown as { isSupported: () => boolean }).isSupported = () => true;
  WebSerialPort.prototype.requestAndOpen = async function (): Promise<void> {
    requestAndOpenCalls += 1;
    throw new Error('requestAndOpen should not run for T3-48 MachineService path');
  };
  WebSerialPort.prototype.connectKnownPortOrPrompt = async function (
    _baudRate: number,
    _fingerprint?: DeviceFingerprint,
    _signal?: AbortSignal,
  ): Promise<KnownPortConnectResult> {
    connectKnownCalls += 1;
    lastBaudRate = _baudRate;
    lastFingerprint = _fingerprint;
    lastConnectSignal = _signal;
    return nextResult;
  };
  WebSerialPort.prototype.close = async function (): Promise<void> {};

  try {
    // 1. Stored serial fingerprint is passed to WebSerialPort so the
    //    profile's exact previously-authorized device is preferred.
    {
      setActiveSerialProfile({
        baudRate: 230400,
        connection: {
          kind: 'serial',
          baudRate: 230400,
          fingerprint: { usbVendorId: 0x1a86, usbProductId: 0x7523 },
        } as DeviceProfile['connection'],
      });
      const ctrl = makeControllerSpy();
      const portRef = { current: null } as { current: SerialPortLike | null };
      const svc = new MachineService(
        { current: ctrl.controller } as { current: LaserController },
        portRef,
      );

      await svc.connectRealLaser(230400);

      assert(connectKnownCalls === 1, 'stored fingerprint: connectKnownPortOrPrompt called once');
      assert(requestAndOpenCalls === 0, 'stored fingerprint: requestAndOpen was not called directly');
      assert(lastBaudRate === 230400, 'stored fingerprint: baud rate forwarded');
      assert(lastFingerprint?.usbVendorId === 0x1a86, 'stored fingerprint: vendor id forwarded');
      assert(lastFingerprint?.usbProductId === 0x7523, 'stored fingerprint: product id forwarded');
      assert(lastConnectSignal instanceof AbortSignal, 'stored fingerprint: service-owned AbortSignal forwarded');
      assert(ctrl.connectCalls === 1, 'stored fingerprint: controller handshake still runs');
      assert(ctrl.lastPort === portRef.current, 'stored fingerprint: controller receives the opened WebSerialPort');
    }

    // 2. Prompt fallback result captures the newly selected USB
    //    descriptor and persists it onto the active serial profile.
    {
      connectKnownCalls = 0;
      requestAndOpenCalls = 0;
      lastFingerprint = undefined;
      nextResult = {
        usedKnownPort: false,
        fingerprint: { usbVendorId: 0x2341, usbProductId: 0x0043 },
      };
      const profile = setActiveSerialProfile({
        connection: { kind: 'serial', baudRate: 115200 } as DeviceProfile['connection'],
      });
      const ctrl = makeControllerSpy();
      const portRef = { current: null } as { current: SerialPortLike | null };
      const svc = new MachineService(
        { current: ctrl.controller } as { current: LaserController },
        portRef,
      );

      await svc.connectRealLaser(115200);

      const saved = getActiveProfile();
      assert(connectKnownCalls === 1, 'captured fingerprint: connectKnownPortOrPrompt called');
      assert(lastFingerprint === undefined, 'captured fingerprint: no stale fingerprint forwarded');
      assert(saved?.id === profile.id, 'captured fingerprint: same profile remains active');
      assert(saved?.connection?.kind === 'serial', 'captured fingerprint: active profile remains serial');
      assert(saved?.connection?.kind === 'serial'
        && saved.connection.fingerprint?.usbVendorId === 0x2341,
        'captured fingerprint: vendor id persisted to active profile');
      assert(saved?.connection?.kind === 'serial'
        && saved.connection.fingerprint?.usbProductId === 0x0043,
        'captured fingerprint: product id persisted to active profile');
      assert(saved?.connection?.kind === 'serial'
        && saved.connection.baudRate === 115200,
        'captured fingerprint: serial connection baud rate persisted');
    }

    // 3. Source-level guard: the production path consumes the T3-48
    //    helper, and the serial profile schema has a fingerprint slot.
    assert(/connectKnownPortOrPrompt\(\s*baudRate,\s*profileFingerprint,\s*connectSignal,\s*resolveSerialSignals\(activeProfile\),\s*\)/.test(machineServiceSource),
      'source pin: MachineService uses connectKnownPortOrPrompt with profile fingerprint, AbortSignal, and optional serial signals');
    assert(!/await\s+ws\.requestAndOpen\(baudRate,\s*connectSignal\)/.test(machineServiceSource),
      'source pin: MachineService no longer calls prompt-only requestAndOpen directly');
    assert(/fingerprint\?:\s*SerialDeviceFingerprint/.test(profileSource),
      'source pin: serial DeviceConnection persists a USB fingerprint');
  } finally {
    (WebSerialPort as unknown as { isSupported: () => boolean }).isSupported = origIsSupported;
    WebSerialPort.prototype.requestAndOpen = origRequestAndOpen;
    WebSerialPort.prototype.connectKnownPortOrPrompt = origConnectKnown;
    WebSerialPort.prototype.close = origClose;
    resetDeviceProfilesForTest();
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
