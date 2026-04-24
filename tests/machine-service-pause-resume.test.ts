/**
 * MachineService.pause() / resume() map 1:1 to the controller.
 * Run: npx tsx tests/machine-service-pause-resume.test.ts
 */
import { MachineService } from '../src/app/MachineService';
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

const pauseCalls: string[] = [];
const resumeCalls: string[] = [];

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
  pause: () => {
    pauseCalls.push('pause');
  },
  resume: () => {
    resumeCalls.push('resume');
  },
  stop: () => {},
  emergencyStop: () => {},
  sendCommand: () => {},
  requestStatusReport: () => {},
  onStateChange: () => () => {},
  onProgress: () => () => {},
  onError: () => () => {},
  onRawLine: () => () => {},
} as LaserController;

const controllerRef = { current: mockController } as { current: LaserController };
const portRef = { current: null } as { current: SerialPortLike | null };
const svc = new MachineService(controllerRef, portRef);

console.log('\n=== machine-service pause/resume ===\n');

pauseCalls.length = 0;
resumeCalls.length = 0;
svc.pause();
assert(pauseCalls.length === 1 && resumeCalls.length === 0, 'pause() calls controller.pause() once, not resume');
assert(pauseCalls[0] === 'pause', 'pause() path is pause');

pauseCalls.length = 0;
resumeCalls.length = 0;
svc.resume();
assert(resumeCalls.length === 1 && pauseCalls.length === 0, 'resume() calls controller.resume() once, not pause');
assert(resumeCalls[0] === 'resume', 'resume() path is resume');

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
