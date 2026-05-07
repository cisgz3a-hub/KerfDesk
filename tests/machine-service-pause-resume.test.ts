/**
 * MachineService.pause() / resume() map 1:1 to the controller and
 * return T2-41 SafetyActionResult outcomes.
 * Run: npx tsx tests/machine-service-pause-resume.test.ts
 */
import { MachineService } from '../src/app/MachineService';
import type { SafetyActionResult } from '../src/app/SafetyActionResult';
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
const rawPauseCalls: string[] = [];
const rawResumeCalls: string[] = [];

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
    rawPauseCalls.push('pause');
  },
  resume: () => {
    rawResumeCalls.push('resume');
  },
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
    pauseJob: async () => {
      pauseCalls.push('pause');
      return { ok: true };
    },
    resumeJob: async () => {
      resumeCalls.push('resume');
      return { ok: true };
    },
    stopJob: async () => ({ ok: true }),
    emergencyStop: async () => ({ ok: true }),
  },
} as unknown as LaserController;

const controllerRef = { current: mockController } as { current: LaserController };
const portRef = { current: null } as { current: SerialPortLike | null };
const svc = new MachineService(controllerRef, portRef);

console.log('\n=== machine-service pause/resume ===\n');

void (async () => {

pauseCalls.length = 0;
resumeCalls.length = 0;
rawPauseCalls.length = 0;
rawResumeCalls.length = 0;
const pauseResult: SafetyActionResult = await svc.pause();
assert(pauseCalls.length === 1 && resumeCalls.length === 0, 'pause() calls operations.pauseJob() once, not resume');
assert(rawPauseCalls.length === 0 && rawResumeCalls.length === 0, 'pause() does not call raw controller pause/resume');
assert(pauseCalls[0] === 'pause', 'pause() operation path is pause');
assert(pauseResult.action === 'pause', 'pause() result action=pause');
assert(pauseResult.accepted === true, 'pause() result accepted=true');
assert(pauseResult.motionState === 'paused', 'pause() result motionState=paused');
assert(pauseResult.laserState === 'commandedOff', 'pause() result laserState=commandedOff');
assert(pauseResult.positionTrusted === true, 'pause() preserves position trust');
assert(pauseResult.requiresRehome === false, 'pause() does not require rehome');

pauseCalls.length = 0;
resumeCalls.length = 0;
rawPauseCalls.length = 0;
rawResumeCalls.length = 0;
const resumeResult: SafetyActionResult = await svc.resume();
assert(resumeCalls.length === 1 && pauseCalls.length === 0, 'resume() calls operations.resumeJob() once, not pause');
assert(rawPauseCalls.length === 0 && rawResumeCalls.length === 0, 'resume() does not call raw controller pause/resume');
assert(resumeCalls[0] === 'resume', 'resume() operation path is resume');
assert(resumeResult.action === 'resume', 'resume() result action=resume');
assert(resumeResult.accepted === true, 'resume() result accepted=true');
assert(resumeResult.motionState === 'running', 'resume() result motionState=running');
assert(resumeResult.positionTrusted === true, 'resume() preserves position trust');

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
