import { describe, expect, it } from 'vitest';
import {
  createStreamer,
  disconnect,
  onAck,
  parseStatusReport,
  step,
} from '../../core/controllers/grbl';
import { automaticRestart } from '../../core/recovery/automatic-restart-line';
import { checkpointInterruption, currentRunPlannerBacklog } from '../app/checkpoint-interruption';
import { statusBufferPatch } from './laser-rx-capacity-evidence';
import { handleLine } from './laser-line-handler';
import { makeLineHandlerHarness } from './laser-line-handler.test-support';

type EvidenceState = Parameters<typeof statusBufferPatch>[0];

function report(line: string) {
  const parsed = parseStatusReport(line);
  if (parsed === null) throw new Error('Invalid planner status fixture');
  return parsed;
}

function quiet(): EvidenceState {
  return {
    streamer: null,
    streamerEpoch: 7,
    pendingUntrackedAcks: 0,
    controllerSessionEpoch: 3,
    rxCapacityEvidence: null,
    plannerCapacityEvidence: null,
  };
}

function observe(state: EvidenceState, line: string, now = 1) {
  return { ...state, ...statusBufferPatch(state, report(line), now) };
}

const PROGRAM = Array.from({ length: 30 }, (_, i) => `G1 X${i + 1} Y0 F600 S500`).join('\n');
const IDLE = '<Idle|MPos:10,0,0|Bf:15,128|FS:0,0>';

function afterTwentyAcks() {
  let streamer = step(createStreamer(PROGRAM, { streamingMode: 'ping-pong' })).state;
  for (let acknowledged = 0; acknowledged < 20; acknowledged += 1) {
    streamer = step(onAck(streamer, 'ok').state).state;
  }
  expect(streamer.completed).toBe(20);
  expect(streamer.queueIndex).toBe(21);
  expect(streamer.inFlight.map((pending) => pending.line)).toEqual(['G1 X21 Y0 F600 S500\n']);
  const rxFree = 128 - new TextEncoder().encode(streamer.inFlight[0]!.line).length;
  expect(rxFree).toBe(108);
  return { streamer, status: `<Run|MPos:17,0,0|Bf:12,${rxFree}|FS:600,500>` };
}

describe('qualified planner capacity and recovery frontier', () => {
  it.each([
    ['acknowledged Jog first', '<Jog|MPos:1,0,0|Bf:14,128|FS:600,0>'],
    ['Idle first', IDLE],
  ])('replays all three planner moves after twenty real ACKs: %s', (_label, firstReport) => {
    const beforeJob = observe(observe(quiet(), firstReport), IDLE, 2);
    const { streamer, status } = afterTwentyAcks();
    const live = observe({ ...beforeJob, streamer }, status, 3);
    const interruption = checkpointInterruption(
      'cancelled',
      null,
      { reason: 'operator', streamerEpoch: 7 },
      currentRunPlannerBacklog(live),
    );

    // At capacity 15, Bf:12 leaves moves 18, 19 and 20 unfinished. The
    // twenty-byte line 21 is still in RX and is not one of those three moves.
    expect(automaticRestart(PROGRAM, 20, interruption ?? undefined)).toMatchObject({
      line: 18,
      plannerBacklogBlocks: 3,
    });
  });

  it.each(['Run', 'Jog', 'Hold:0', 'Door:0', 'Home', 'Alarm', 'Check', 'Sleep', 'Tool'])(
    'keeps planner capacity unknown after an acknowledged %s report',
    (controllerState) => {
      const beforeJob = observe(quiet(), `<${controllerState}|MPos:0,0,0|Bf:14,128|FS:0,0>`);
      expect(beforeJob.rxCapacityEvidence?.rxBytesFree).toBe(128);
      expect(beforeJob.plannerCapacityEvidence).toBeNull();
      const { streamer, status } = afterTwentyAcks();
      const live = observe({ ...beforeJob, streamer }, status);
      expect(currentRunPlannerBacklog(live)).toBeUndefined();
    },
  );

  it.each([128, 120])(
    'learns Idle planner capacity independently of RX high-water %i',
    (rxFree) => {
      const beforeIdle = observe(quiet(), '<Jog|MPos:1,0,0|Bf:14,128|FS:600,0>');
      const idle = observe(beforeIdle, `<Idle|MPos:10,0,0|Bf:15,${rxFree}|FS:0,0>`, 2);
      expect(idle.rxCapacityEvidence).toBe(beforeIdle.rxCapacityEvidence);
      expect(idle.plannerCapacityEvidence).toMatchObject({ plannerBlocksFree: 15, observedAt: 2 });
    },
  );

  it('refreshes planner capacity at the next qualified Idle without changing RX evidence', () => {
    const previous = observe(quiet(), IDLE);
    const refreshed = observe(previous, '<Idle|MPos:10,0,0|Bf:16,128|FS:0,0>', 2);
    expect(refreshed.rxCapacityEvidence).toBe(previous.rxCapacityEvidence);
    expect(refreshed.plannerCapacityEvidence).toEqual({
      plannerBlocksFree: 16,
      sessionEpoch: 3,
      observedAt: 2,
    });
  });

  it('uses newly qualified Idle capacity for the snapshot in that same report', () => {
    const done = onAck(step(createStreamer('M5\n')).state, 'ok').state;
    expect(done.status).toBe('done');
    const previous = { ...observe(quiet(), IDLE), streamer: done };
    const idle = observe(previous, '<Idle|MPos:10,0,0|Bf:8,128|FS:0,0>', 2);
    expect(idle.plannerCapacityEvidence).toMatchObject({ plannerBlocksFree: 8 });
    expect(idle.streamPlannerSnapshot).toEqual({
      streamerEpoch: 7,
      sessionEpoch: 3,
      ackedLines: 1,
      queuedBlocks: 0,
    });
  });

  it('does not replace qualified planner evidence with a larger RX report during motion', () => {
    const idle = observe(quiet(), IDLE);
    const moving = observe(idle, '<Jog|MPos:1,0,0|Bf:14,256|FS:600,0>', 2);
    expect(moving.rxCapacityEvidence?.rxBytesFree).toBe(256);
    expect(moving.plannerCapacityEvidence).toBe(idle.plannerCapacityEvidence);
  });

  it('requires settled host ACK ownership even when the controller reports Idle', () => {
    expect(
      observe({ ...quiet(), pendingUntrackedAcks: 1 }, IDLE).plannerCapacityEvidence,
    ).toBeNull();
    const streamer = step(createStreamer('G1 X1\n')).state;
    expect(observe({ ...quiet(), streamer }, IDLE).plannerCapacityEvidence).toBeNull();
  });

  it('never guesses planner size when Bf or current-session evidence is missing', () => {
    const noBuffer = observe(quiet(), '<Idle|MPos:10,0,0|FS:0,0>');
    expect(noBuffer.plannerCapacityEvidence).toBeNull();
    const oldSession = observe(quiet(), IDLE);
    const { streamer, status } = afterTwentyAcks();
    const stale = observe({ ...oldSession, controllerSessionEpoch: 4, streamer }, status);
    expect(currentRunPlannerBacklog(stale)).toBeUndefined();
    const refreshed = observe({ ...stale, streamer: null }, IDLE, 4);
    expect(refreshed.plannerCapacityEvidence).toMatchObject({ sessionEpoch: 4, observedAt: 4 });
    expect(currentRunPlannerBacklog(observe({ ...refreshed, streamer }, status))).toEqual({
      ackedAtStatus: 20,
      queuedBlocks: 3,
    });
  });

  it('does not reuse a previous stream snapshot for a new stream owner', () => {
    const { streamer, status } = afterTwentyAcks();
    const live = observe({ ...observe(quiet(), IDLE), streamer }, status);
    expect(currentRunPlannerBacklog(live)).toEqual({ ackedAtStatus: 20, queuedBlocks: 3 });
    // Without a snapshot of its own the new owner is bounded by the whole
    // planner (OR-3), never by the previous run's backlog.
    expect(currentRunPlannerBacklog({ ...live, streamerEpoch: 8 })).toEqual({
      ackedAtStatus: 20,
      queuedBlocks: 15,
      bound: 'planner-size',
    });
    const replacement = observe(
      {
        ...live,
        streamerEpoch: 8,
        controllerSessionEpoch: 4,
        plannerCapacityEvidence: { plannerBlocksFree: 15, sessionEpoch: 4, observedAt: 4 },
      },
      status,
      5,
    );
    expect(replacement.streamPlannerSnapshot).toEqual({
      streamerEpoch: 8,
      sessionEpoch: 4,
      ackedLines: 20,
      queuedBlocks: 3,
    });
  });

  it('accepts new-session Idle evidence while the disconnected stream awaits recovery', () => {
    const { streamer } = afterTwentyAcks();
    const disconnected = disconnect(streamer);
    expect(disconnected.inFlight).toHaveLength(1);
    const idle = observe(
      { ...quiet(), controllerSessionEpoch: 4, streamer: disconnected },
      IDLE,
      4,
    );
    expect(idle.plannerCapacityEvidence).toEqual({
      plannerBlocksFree: 15,
      sessionEpoch: 4,
      observedAt: 4,
    });
    // No run snapshot: the whole planner bounds the backlog (OR-3), and new-
    // session motion never becomes the old run's backlog.
    const bounded = { ackedAtStatus: 20, queuedBlocks: 15, bound: 'planner-size' };
    expect(currentRunPlannerBacklog(idle)).toEqual(bounded);
    const jog = observe(idle, '<Jog|MPos:1,0,0|Bf:14,128|FS:600,0>', 5);
    expect(currentRunPlannerBacklog(jog)).toEqual(bounded);
    // A lost link does not discard the planner, so nothing is attached.
    expect(
      checkpointInterruption('disconnected', null, null, currentRunPlannerBacklog(jog)),
    ).not.toHaveProperty('plannerBacklog');
  });

  it('bounds a reboot without a backlog report by the planner, never by later motion', () => {
    const { refs, set, get } = makeLineHandlerHarness();
    const { streamer, status } = afterTwentyAcks();
    set({
      streamer,
      streamerEpoch: 7,
      controllerSessionEpoch: 3,
      rxCapacityEvidence: null,
      plannerCapacityEvidence: null,
      streamPlannerSnapshot: null,
    });
    const receive = (line: string) => handleLine(set, get, refs, async () => undefined, line);

    receive('Grbl 1.1f');
    expect(get().streamer?.status).toBe('errored');
    // OR-3: the reboot discarded up to a stock GRBL planner (15 blocks) of the
    // twenty acknowledged moves, and no report showed how many.
    expect(currentRunPlannerBacklog(get())).toEqual({
      ackedAtStatus: 20,
      queuedBlocks: 15,
      bound: 'planner-size',
    });

    receive(IDLE);
    expect(get().plannerCapacityEvidence).toMatchObject({ plannerBlocksFree: 15, sessionEpoch: 4 });
    // The real status pipeline releases the interrupted streamer at Idle in
    // the same store update. Later motion cannot be mistaken for the old run.
    expect(get().streamer).toBeNull();
    receive('<Jog|MPos:1,0,0|Bf:14,128|FS:600,0>');
    expect(currentRunPlannerBacklog(get())).toBeUndefined();
    expect(
      checkpointInterruption('errored', get().safetyNotice, null, currentRunPlannerBacklog(get())),
    ).not.toHaveProperty('plannerBacklog');

    // The qualified capacity is still usable by a fresh stream owner.
    set({ streamer, streamerEpoch: 8 });
    receive(status);
    expect(currentRunPlannerBacklog(get())).toEqual({ ackedAtStatus: 20, queuedBlocks: 3 });
  });
});
