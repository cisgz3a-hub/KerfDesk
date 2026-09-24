import { describe, expect, it } from 'vitest';
import { createStreamer, parseStatusReport, step } from '../../core/controllers/grbl';
import {
  currentRxCapacityEvidence,
  hostHasNothingInFlight,
  rxCapacityEvidencePatch,
  statusBufferPatch,
} from './laser-rx-capacity-evidence';

function report(line: string) {
  const parsed = parseStatusReport(line);
  if (parsed === null) throw new Error(`test status report did not parse: ${line}`);
  return parsed;
}

const IDLE_FALCON = report('<Idle|MPos:0.000,0.000,0.000,0.000|Bf:512,65535|FS:0,0>');
const QUIET = { streamer: null, pendingUntrackedAcks: 0, controllerSessionEpoch: 3 };

describe('rxCapacityEvidencePatch (ADR-331)', () => {
  it('latches the free RX bytes of a report taken while nothing is in flight', () => {
    expect(
      rxCapacityEvidencePatch({ ...QUIET, rxCapacityEvidence: null }, IDLE_FALCON, 1000),
    ).toEqual({
      rxCapacityEvidence: {
        rxBytesFree: 65535,
        plannerBlocksFree: 512,
        sessionEpoch: 3,
        observedAt: 1000,
      },
    });
  });

  it('ignores reports without a Bf field', () => {
    const noBf = report('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    expect(rxCapacityEvidencePatch({ ...QUIET, rxCapacityEvidence: null }, noBf, 1)).toEqual({});
  });

  it('ignores reports taken while job lines are in flight or commands owe acks', () => {
    const streaming = step(createStreamer('G1 X1\nG1 X2\n')).state;
    expect(streaming.inFlight.length).toBeGreaterThan(0);
    expect(
      rxCapacityEvidencePatch(
        { ...QUIET, streamer: streaming, rxCapacityEvidence: null },
        IDLE_FALCON,
        1,
      ),
    ).toEqual({});
    expect(
      rxCapacityEvidencePatch(
        { ...QUIET, pendingUntrackedAcks: 1, rxCapacityEvidence: null },
        IDLE_FALCON,
        1,
      ),
    ).toEqual({});
    expect(hostHasNothingInFlight({ streamer: streaming, pendingUntrackedAcks: 0 })).toBe(false);
    expect(hostHasNothingInFlight({ streamer: null, pendingUntrackedAcks: 0 })).toBe(true);
  });

  it('keeps the largest reading of the session and replaces a stale session', () => {
    const smaller = report('<Idle|MPos:0.000,0.000,0.000|Bf:15,120|FS:0,0>');
    const latched = {
      rxBytesFree: 128,
      plannerBlocksFree: 15,
      sessionEpoch: 3,
      observedAt: 5,
    };
    expect(rxCapacityEvidencePatch({ ...QUIET, rxCapacityEvidence: latched }, smaller, 9)).toEqual(
      {},
    );
    expect(
      rxCapacityEvidencePatch(
        { ...QUIET, controllerSessionEpoch: 4, rxCapacityEvidence: latched },
        smaller,
        9,
      ),
    ).toEqual({
      rxCapacityEvidence: {
        rxBytesFree: 120,
        plannerBlocksFree: 15,
        sessionEpoch: 4,
        observedAt: 9,
      },
    });
  });

  it('exposes only current-session evidence', () => {
    const latched = { rxBytesFree: 65535, plannerBlocksFree: 512, sessionEpoch: 3, observedAt: 1 };
    expect(
      currentRxCapacityEvidence({ controllerSessionEpoch: 3, rxCapacityEvidence: latched }),
    ).toBe(latched);
    expect(
      currentRxCapacityEvidence({ controllerSessionEpoch: 4, rxCapacityEvidence: latched }),
    ).toBeNull();
    expect(currentRxCapacityEvidence({ controllerSessionEpoch: 4 })).toBeNull();
  });
});

// Controller audit recovery-6: during a run each report records how many
// planner blocks still wait behind the acknowledgements counted so far.
describe('statusBufferPatch planner snapshot', () => {
  const CAPACITY = {
    rxBytesFree: 65535,
    plannerBlocksFree: 512,
    sessionEpoch: 3,
    observedAt: 1,
  };
  const RUNNING = report('<Run|MPos:1.000,0.000,0.000,0.000|Bf:132,20000|FS:1200,300>');

  it('records the backlog of an active run', () => {
    const streamer = { ...step(createStreamer('G1 X1\nG1 X2\n')).state, completed: 400 };
    const patch = statusBufferPatch(
      { ...QUIET, streamer, streamerEpoch: 5, rxCapacityEvidence: CAPACITY },
      RUNNING,
      2,
    );
    expect(patch.streamPlannerSnapshot).toEqual({
      streamerEpoch: 5,
      ackedLines: 400,
      queuedBlocks: 380,
    });
  });

  it('records nothing without a run or without the idle planner size', () => {
    expect(
      statusBufferPatch({ ...QUIET, streamerEpoch: 5, rxCapacityEvidence: CAPACITY }, RUNNING, 2),
    ).not.toHaveProperty('streamPlannerSnapshot');
    const streamer = step(createStreamer('G1 X1\n')).state;
    expect(
      statusBufferPatch(
        { ...QUIET, streamer, streamerEpoch: 5, rxCapacityEvidence: null },
        RUNNING,
        2,
      ),
    ).not.toHaveProperty('streamPlannerSnapshot');
  });
});
