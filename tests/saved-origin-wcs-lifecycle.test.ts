/**
 * T3-37: saved-origin / WCS lifecycle regression coverage.
 *
 * The saved-origin workflow depends on two separate facts staying in sync:
 * the UI's saved-origin point and GRBL's live G54 / temporary WCS state. This
 * test pins the lifecycle around Set Origin, reconnect/WCS normalize drift,
 * and user console WCS mutation.
 *
 * Run: npx tsx tests/saved-origin-wcs-lifecycle.test.ts
 */
import { readFileSync } from 'node:fs';
import { MachineService } from '../src/app/MachineService';
import { type ApprovalToken } from '../src/app/MachineCommandGateway';
import { verifySavedOriginG54 } from '../src/app/savedOriginVerify';
import { type LaserController } from '../src/controllers/ControllerInterface';
import { type SerialPortLike } from '../src/communication/SerialPort';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function assertVerifyOk(
  svc: MachineService,
  currentG54: { x: number; y: number; z: number } | null,
  message: string,
): void {
  const result = verifySavedOriginG54(svc.getSavedOriginG54Snapshot(), currentG54);
  assert(result.ok === true, message);
}

function assertVerifyBlocked(
  svc: MachineService,
  currentG54: { x: number; y: number; z: number } | null,
  expectedReason: string,
  message: string,
): void {
  const result = verifySavedOriginG54(svc.getSavedOriginG54Snapshot(), currentG54);
  assert(result.ok === false && result.reason === expectedReason, `${message}; got ${result.ok ? 'ok' : result.reason}`);
}

interface Harness {
  service: MachineService;
  sent: Array<{ cmd: string; source: 'internal' | 'user' }>;
  setLiveG54(next: { x: number; y: number; z: number } | null): void;
}

function makeHarness(): Harness {
  const sent: Array<{ cmd: string; source: 'internal' | 'user' }> = [];
  let liveG54: { x: number; y: number; z: number } | null = { x: 100, y: 75, z: 0 };

  const controller = {
    protocolName: 'mock',
    state: {
      status: 'idle',
      position: { x: 0, y: 0, z: 0 },
      feedRate: 0,
      spindleSpeed: 0,
      alarmCode: null,
      errorCode: null,
    },
    isJobRunning: false,
    maxSpindle: null,
    connect: async () => {},
    disconnect: async () => {},
    sendJob: async () => {},
    pause: () => {},
    resume: () => {},
    stop: () => {},
    emergencyStop: () => {},
    sendCommand: (cmd: string, source?: 'internal' | 'user') => {
      sent.push({ cmd, source: source ?? 'internal' });
      if (/^G10(?![0-9])/i.test(cmd) || /^G92(?![0-9])/i.test(cmd)) {
        liveG54 = { x: 0, y: 0, z: 0 };
      }
    },
    requestStatusReport: () => {},
    requestWorkOffsets: async () => liveG54,
    onStateChange: () => () => {},
    onProgress: () => () => {},
    onError: () => () => {},
    onRawLine: () => () => {},
    safetyOff: async () => ({ stage: 'm5' as const }),
    __setLiveG54(next: { x: number; y: number; z: number } | null) {
      liveG54 = next;
    },
  } as unknown as LaserController & {
    __setLiveG54(next: { x: number; y: number; z: number } | null): void;
  };

  const service = new MachineService(
    { current: controller } as { current: LaserController },
    { current: null } as { current: SerialPortLike | null },
  );

  return {
    service,
    sent,
    setLiveG54: (next) => controller.__setLiveG54(next),
  };
}

async function main(): Promise<void> {
  console.log('\n=== T3-37 saved-origin / WCS lifecycle ===\n');

  {
    const { service } = makeHarness();
    service.setSavedOriginG54Snapshot({ x: 100, y: 75, z: 0 });
    assertVerifyOk(
      service,
      await service.requestWorkOffsets(),
      'saved-origin lifecycle: unchanged live G54 verifies before job start',
    );
  }

  {
    const { service, setLiveG54 } = makeHarness();
    service.setSavedOriginG54Snapshot({ x: 100, y: 75, z: 0 });
    setLiveG54({ x: 0, y: 0, z: 0 });
    assertVerifyBlocked(
      service,
      await service.requestWorkOffsets(),
      'drift',
      'saved-origin lifecycle: WCS normalization between Set Origin and Start blocks as drift',
    );
  }

  {
    const { service, sent } = makeHarness();
    service.setSavedOriginG54Snapshot({ x: 100, y: 75, z: 0 });
    const token = service.requestApproval('G10 L2 P1 X0 Y0') as ApprovalToken;
    await service.sendCommand('G10 L2 P1 X0 Y0', 'user', token);
    assert(sent.length === 1 && sent[0]?.cmd === 'G10 L2 P1 X0 Y0', 'approved console G10 reaches controller');
    assert(
      service.getSavedOriginG54Snapshot() === null,
      'approved console G10 invalidates saved-origin G54 snapshot immediately',
    );
  }

  {
    const { service } = makeHarness();
    service.setSavedOriginG54Snapshot({ x: 100, y: 75, z: 0 });
    const token = service.requestApproval('G92 X0 Y0') as ApprovalToken;
    await service.sendCommand('G92 X0 Y0', 'user', token);
    assert(
      service.getSavedOriginG54Snapshot() === null,
      'approved console G92 invalidates saved-origin snapshot because G54-only verification cannot see temporary offsets',
    );
  }

  {
    const { service, sent } = makeHarness();
    service.setSavedOriginG54Snapshot({ x: 100, y: 75, z: 0 });
    const command = 'G90 G10 L20 P1 X0 Y0';
    const token = service.requestApproval(command) as ApprovalToken;
    await service.sendCommand(command, 'user', token);
    assert(sent.length === 1 && sent[0]?.cmd === command, 'approved embedded console G10 reaches controller');
    assert(
      service.getSavedOriginG54Snapshot() === null,
      'approved embedded console G10 invalidates saved-origin G54 snapshot immediately',
    );
  }

  {
    const { service, sent } = makeHarness();
    service.setSavedOriginG54Snapshot({ x: 100, y: 75, z: 0 });
    let blocked = false;
    try {
      await service.sendCommand('G10 L2 P1 X0 Y0', 'user');
    } catch {
      blocked = true;
    }
    assert(blocked, 'unapproved console G10 is still blocked by the approval-token gate');
    assert(sent.length === 0, 'blocked console G10 never reaches controller');
    assert(
      service.getSavedOriginG54Snapshot()?.x === 100,
      'blocked console G10 does not invalidate saved origin because no machine mutation happened',
    );
  }

  {
    const source = readFileSync('src/ui/components/ConnectionPanelMain.tsx', 'utf8');
    assert(
      source.includes('verifySavedOriginG54(expectedG54, currentG54)')
        && source.includes("startMode === 'savedOrigin'"),
      'ConnectionPanelMain still verifies saved-origin G54 immediately before Start',
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
