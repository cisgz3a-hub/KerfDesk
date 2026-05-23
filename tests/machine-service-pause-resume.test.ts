/**
 * MachineService.pause() / resume() map 1:1 to the controller and
 * return T2-41 SafetyActionResult outcomes.
 * Run: npx tsx tests/machine-service-pause-resume.test.ts
 */
import { MachineService } from '../src/app/MachineService';
import type { SafetyActionResult } from '../src/app/SafetyActionResult';
import { grblCapabilities, type ControllerCapabilities } from '../src/controllers/ControllerCapabilities';
import { type LaserController, type MachineState } from '../src/controllers/ControllerInterface';
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
let isMockJobRunning = false;
const mockMachineState: MachineState = {
  status: 'idle',
  position: { x: 0, y: 0, z: 0 },
  feedRate: 0,
  spindleSpeed: 0,
  alarmCode: null,
  errorCode: null,
};
let mockCapabilities: ControllerCapabilities = grblCapabilities;

const mockController: LaserController = {
  protocolName: 'mock',
  get state() {
    return mockMachineState;
  },
  get capabilities() {
    return mockCapabilities;
  },
  get isJobRunning() {
    return isMockJobRunning;
  },
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

function reset(status: typeof mockMachineState.status, capabilities: ControllerCapabilities = grblCapabilities): void {
  mockMachineState.status = status;
  mockCapabilities = capabilities;
  isMockJobRunning = false;
  pauseCalls.length = 0;
  resumeCalls.length = 0;
  rawPauseCalls.length = 0;
  rawResumeCalls.length = 0;
}

reset('run');
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

reset('hold');
isMockJobRunning = true;
const resumeResult: SafetyActionResult = await svc.resume();
assert(resumeCalls.length === 1 && pauseCalls.length === 0, 'resume() calls operations.resumeJob() once, not pause');
assert(rawPauseCalls.length === 0 && rawResumeCalls.length === 0, 'resume() does not call raw controller pause/resume');
assert(resumeCalls[0] === 'resume', 'resume() operation path is resume');
assert(resumeResult.action === 'resume', 'resume() result action=resume');
assert(resumeResult.accepted === true, 'resume() result accepted=true');
assert(resumeResult.motionState === 'running', 'resume() result motionState=running');
assert(resumeResult.positionTrusted === true, 'resume() preserves position trust');

reset('hold');
const unownedHoldResumeResult = await svc.resume();
assert(resumeCalls.length === 0, 'resume() for unowned Hold does not call operations.resumeJob');
assert(unownedHoldResumeResult.accepted === false, 'resume() for unowned Hold returns accepted=false');
assert(/no active laserforge job/i.test(unownedHoldResumeResult.message ?? ''),
  `resume() for unowned Hold message names ownership gate (got: ${unownedHoldResumeResult.message ?? ''})`);

reset('idle');
const idlePauseResult = await svc.pause();
assert(pauseCalls.length === 0, 'pause() while idle does not call operations.pauseJob');
assert(idlePauseResult.accepted === false, 'pause() while idle returns accepted=false');
assert(/pause requires/i.test(idlePauseResult.message ?? ''),
  `pause() while idle message names state gate (got: ${idlePauseResult.message ?? ''})`);

reset('run', {
  ...grblCapabilities,
  operations: { ...grblCapabilities.operations, canPause: false },
});
const unsupportedPauseResult = await svc.pause();
assert(pauseCalls.length === 0, 'pause() with canPause=false does not call operations.pauseJob');
assert(unsupportedPauseResult.accepted === false, 'pause() with canPause=false returns accepted=false');
assert(/does not support pause/i.test(unsupportedPauseResult.message ?? ''),
  `pause() with canPause=false message names capability gate (got: ${unsupportedPauseResult.message ?? ''})`);

reset('run');
const runResumeResult = await svc.resume();
assert(resumeCalls.length === 0, 'resume() while running does not call operations.resumeJob');
assert(runResumeResult.accepted === false, 'resume() while running returns accepted=false');
assert(/resume requires/i.test(runResumeResult.message ?? ''),
  `resume() while running message names state gate (got: ${runResumeResult.message ?? ''})`);

reset('hold', {
  ...grblCapabilities,
  operations: { ...grblCapabilities.operations, canResume: false },
});
const unsupportedResumeResult = await svc.resume();
assert(resumeCalls.length === 0, 'resume() with canResume=false does not call operations.resumeJob');
assert(unsupportedResumeResult.accepted === false, 'resume() with canResume=false returns accepted=false');
assert(/does not support resume/i.test(unsupportedResumeResult.message ?? ''),
  `resume() with canResume=false message names capability gate (got: ${unsupportedResumeResult.message ?? ''})`);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
