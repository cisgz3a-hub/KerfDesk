/**
 * MachineService: classifyUserCommand and sendCommand(source) forwarding.
 * Blocking of dangerous user lines is the UI’s job, not the service.
 * Run: npx tsx tests/machine-service-user-sendcommand.test.ts
 */
import { MachineService } from '../src/app/MachineService';
import { classifyUserCommand } from '../src/controllers/grbl/CommandClassifier';
import { type LaserController } from '../src/controllers/ControllerInterface';
import { type SerialPortLike } from '../src/communication/SerialPort';

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

const sent: Array<{ cmd: string; source: 'internal' | 'user' }> = [];

const mockController: LaserController = {
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
  sendJob: () => Promise.resolve(),
  pause: () => {},
  resume: () => {},
  stop: () => {},
  emergencyStop: () => {},
  sendCommand: (cmd, source) => {
    sent.push({ cmd, source: source ?? 'internal' });
  },
  requestStatusReport: () => {},
  onStateChange: () => () => {},
  onProgress: () => () => {},
  onError: () => () => {},
  onRawLine: () => () => {},
  safetyOff: async () => ({ stage: 'm5' as const }),
} as LaserController;

const controllerRef = { current: mockController } as { current: LaserController };
const portRef = { current: null } as { current: SerialPortLike | null };
const svc = new MachineService(controllerRef, portRef);

async function run(): Promise<void> {
  console.log('\n=== machine-service user sendCommand ===\n');

  {
    const a = svc.classifyUserCommand('$X');
    const b = classifyUserCommand('$X');
    assert(
      a.severity === b.severity && a.command === b.command,
      'classifyUserCommand proxies the shared classifier (dangerous: $X)',
    );
    const c = svc.classifyUserCommand('?');
    const d = classifyUserCommand('?');
    assert(
      c.severity === d.severity,
      'classifyUserCommand proxies the shared classifier (safe: ?)',
    );
  }

  sent.length = 0;
  await svc.sendCommand('?', 'user');
  assert(sent.length === 1, 'one controller send for user ?');
  assert(
    sent[0]?.cmd === '?' && sent[0].source === 'user',
    'forwards (?, user) to controller; service does not block on classification',
  );

  sent.length = 0;
  await svc.sendCommand('$X', 'user');
  assert(sent.length === 1, 'one controller send for user $X');
  assert(
    sent[0]?.cmd === '$X' && sent[0].source === 'user',
    "sendCommand('$X', 'user') is not blocked in MachineService (UI owns gating)",
  );

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
