// A CNC tool-change hold reached by the Resume refill must be entered exactly
// like one reached by an ack (ADR-171): the previous bit's Z0 is voided, the
// fresh-Idle latch re-arms, the prompt names the incoming bit from the tool
// plan, and Continue refuses to stream the next section until that bit is
// zeroed. Before the shared entry patch (tool-change-hold-entry.ts) the refill
// installed the hold bare, so Continue unlocked on the old bit's Z0 (controller
// audit streaming-1). Drives the real store actions over the fake GRBL port.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  prepareCncPauseResumeTest,
  resetCncPauseResumeTest,
} from '../../__fixtures__/controllers/cnc-pause-resume-lifecycle';
import {
  flushPromises,
  makeConnectionHarness,
  PARKED_STATUS,
  RUN_STATUS,
  type ConnectionHarness,
} from '../../__fixtures__/controllers/cnc-pause-resume-store';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { cncControllerEpochOf, createCncSetupAttestation } from './cnc-setup-attestation';
import { useLaserStore } from './laser-store';
import { toolChangeContinueBlockMessage, toolChangeReady } from './laser-store-helpers';
import { settleTestGrblHandshake } from './laser-test-start-helpers';
import { captureWorkZZeroEvidence } from './work-z-zero-evidence';

const IDLE = '<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>';

// KerfDesk's default GRBL window is 120 B. Each cutter section is sized so the
// fill after Start/Continue stops short of its M0: pausing there leaves the
// retract tail queued, and the Resume refill is what reaches the M0 boundary.
function cutterSection(prefix: readonly string[]): string[] {
  return [
    ...prefix,
    ...Array.from({ length: 12 }, (_, index) => `G1 X${index + 1} F300`),
    'G0 Z5',
    'M5',
  ];
}

const SECTION_1 = cutterSection(['G21', 'G90', 'M3 S12000']);
const SECTION_2 = cutterSection(['G0 Z10', 'M3 S12000']);
const SECTION_3 = ['G0 Z10', 'M3 S12000', 'G1 X20 F300', 'M5'];
const PLAN_TWO_TOOLS = [
  { id: 'bit-6mm-flat', name: '6mm flat' },
  { id: 'bit-3mm-end', name: '3mm endmill' },
];
const PLAN_THREE_TOOLS = [...PLAN_TWO_TOOLS, { id: 'bit-6mm-ball', name: '6mm ballnose' }];
const ONE_HOLD_JOB = [...SECTION_1, 'M0', ...SECTION_2].join('\n');
const TWO_HOLD_JOB = [...SECTION_1, 'M0', ...SECTION_2, 'M0', ...SECTION_3].join('\n');

function adapter(connection: SerialConnection): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: async () => ({ open: async () => connection }),
    },
  };
}

async function connectAndStart(
  harness: ConnectionHarness,
  gcode: string,
  plan: ReadonlyArray<{ readonly id: string; readonly name: string }>,
): Promise<void> {
  await useLaserStore.getState().connect(adapter(harness.connection));
  harness.connection.emitLine('Grbl 1.1f');
  harness.connection.emitLine(IDLE);
  await settleTestGrblHandshake();
  const before = useLaserStore.getState();
  useLaserStore.setState({
    controllerSettings: { laserModeEnabled: false },
    accessoryCache: { spindleCw: false, spindleCcw: false, flood: false, mist: false },
    // The operator touched off the FIRST bit before Start.
    workZZeroEvidence: captureWorkZZeroEvidence(
      'manual-zero',
      before.workZReferenceEpoch,
      plan[0]?.id,
    ),
  });
  await useLaserStore.getState().startJob(gcode, {
    machineKind: 'cnc',
    cncSetupAttestation: createCncSetupAttestation(
      gcode,
      cncControllerEpochOf(useLaserStore.getState()),
    ),
    cncToolPlan: plan,
  });
  expect(useLaserStore.getState().streamer?.status).toBe('streaming');
}

async function ackAllInFlight(harness: ConnectionHarness): Promise<void> {
  const count = useLaserStore.getState().streamer?.inFlight.length ?? 0;
  for (let index = 0; index < count; index += 1) harness.connection.emitLine('ok');
  await flushPromises();
}

async function pauseDrainResume(harness: ConnectionHarness): Promise<void> {
  harness.setPauseStatus(PARKED_STATUS);
  await useLaserStore.getState().pauseJob();
  expect(useLaserStore.getState().streamer?.status).toBe('paused');
  // The pre-M0 tail must still be queued, otherwise this is not the refill path.
  const paused = useLaserStore.getState().streamer;
  expect(paused?.queued[paused.queueIndex]).not.toMatch(/^M0/);
  // GRBL acks parsed-but-held lines while the door holds motion.
  await ackAllInFlight(harness);
  harness.setResumeStatus(RUN_STATUS);
  await useLaserStore.getState().resumeJob();
  await flushPromises();
}

function holdFacts() {
  const state = useLaserStore.getState();
  return {
    status: state.streamer?.status,
    pendingToolLabel: state.pendingToolLabel,
    pendingToolId: state.pendingToolId,
    workZZeroEvidence: state.workZZeroEvidence,
    workZReferenceEpoch: state.workZReferenceEpoch,
  };
}

beforeEach(prepareCncPauseResumeTest);
afterEach(resetCncPauseResumeTest);

describe('tool-change hold entered by the Resume refill', () => {
  it('voids the old bit Z0, names the new bit, and keeps Continue from streaming', async () => {
    const harness = makeConnectionHarness();
    await connectAndStart(harness, ONE_HOLD_JOB, PLAN_TWO_TOOLS);
    const epochAtStart = useLaserStore.getState().workZReferenceEpoch;

    await pauseDrainResume(harness);
    expect(useLaserStore.getState().streamer?.status).toBe('tool-change');
    // The retract tail is acked and the machine reports a fresh Idle at the park.
    await ackAllInFlight(harness);
    harness.emitStatus(IDLE);
    await flushPromises();

    expect(holdFacts()).toEqual({
      status: 'tool-change',
      pendingToolLabel: '3mm endmill',
      pendingToolId: 'bit-3mm-end',
      workZZeroEvidence: null,
      workZReferenceEpoch: epochAtStart + 1,
    });
    expect(toolChangeContinueBlockMessage(useLaserStore.getState())).not.toBeNull();

    // Continue without touching off the 3 mm bit must not send the next section.
    const writesBefore = harness.writes.length;
    await useLaserStore.getState().continueToolChange();
    await flushPromises();
    expect(harness.writes.slice(writesBefore).join('')).not.toContain('G0 Z10');
    expect(useLaserStore.getState().streamer?.status).toBe('tool-change');
  });

  it('does not inherit the previous hold latch, bit name or Z0 at a later hold', async () => {
    const harness = makeConnectionHarness();
    await connectAndStart(harness, TWO_HOLD_JOB, PLAN_THREE_TOOLS);

    // Hold 1 is reached by acks.
    for (let pass = 0; pass < 4; pass += 1) {
      if (useLaserStore.getState().streamer?.status === 'tool-change') break;
      await ackAllInFlight(harness);
    }
    await ackAllInFlight(harness);
    harness.emitStatus(IDLE);
    await flushPromises();
    expect(useLaserStore.getState().pendingToolId).toBe('bit-3mm-end');

    // The operator zeroes the 3 mm bit and continues.
    const epochHold1 = useLaserStore.getState().workZReferenceEpoch;
    useLaserStore.setState({
      workZZeroEvidence: captureWorkZZeroEvidence('manual-zero', epochHold1, 'bit-3mm-end'),
    });
    expect(toolChangeContinueBlockMessage(useLaserStore.getState())).toBeNull();
    await useLaserStore.getState().continueToolChange();
    await flushPromises();
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');

    // Pause inside the 3 mm section; the Resume refill reaches hold 2.
    await pauseDrainResume(harness);
    expect(useLaserStore.getState().streamer?.status).toBe('tool-change');

    // The retract/park tail is acked (parsed) but no fresh Idle has arrived: the
    // machine may still be moving to the park, so setup and Continue stay locked.
    await ackAllInFlight(harness);
    const beforeIdle = useLaserStore.getState();
    expect({
      toolChangeIdleSeen: beforeIdle.toolChangeIdleSeen,
      ready: toolChangeReady(beforeIdle),
      continueBlocked: toolChangeContinueBlockMessage(beforeIdle) !== null,
    }).toEqual({ toolChangeIdleSeen: false, ready: false, continueBlocked: true });

    harness.emitStatus(IDLE);
    await flushPromises();
    expect(holdFacts()).toEqual({
      status: 'tool-change',
      pendingToolLabel: '6mm ballnose',
      pendingToolId: 'bit-6mm-ball',
      workZZeroEvidence: null,
      workZReferenceEpoch: epochHold1 + 1,
    });
    expect(toolChangeContinueBlockMessage(useLaserStore.getState())).not.toBeNull();
  });
});
