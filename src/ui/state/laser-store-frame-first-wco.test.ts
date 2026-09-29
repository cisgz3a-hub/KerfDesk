// GRBL includes WCO only in some status reports, so a Frame can start before
// the first one arrives; KerfDesk then places the job at an assumed zero
// offset. GRBL reports WCO in the very next status after any offset change, so
// a first report equal to that zero is the same origin, and a different first
// report is a different one (ADR-375).
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L280-L286
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/doc/markdown/interface.md#L561-L568

import { afterEach, describe, expect, it } from 'vitest';
import {
  FRAME_CONTROLLER_CHANGED_MESSAGE,
  FRAME_START_ORIGIN_CHANGED_MESSAGE,
  framedRunStartHandoffIssue,
} from './framed-run';
import { isVerifiedFrameValid } from './frame-verification';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { resetStore } from './test-helpers';
import {
  acknowledgeAndSettleFrameLeg,
  acknowledgeFrameToolOffPrelude,
  acknowledgeMotionSettlement,
  connectWith,
  flush,
  framedRunCandidate,
  frameTraceCandidate,
  makeConnection,
  type FakeConnection,
} from './laser-store-motion-operation.test-support';

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(initialLaserState());
  resetStore();
});

const BOUNDS = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
const HOME = { x: 0, y: 0 };

/** A Frame, or a split Frame's trace (ADR-353), dispatched before any WCO. */
async function frameWithoutReportedOffset(
  midFrameReport?: string,
  kind: 'exact' | 'trace' = 'exact',
): Promise<{ readonly connection: FakeConnection }> {
  const connection = makeConnection(async () => undefined);
  await connectWith(connection);
  expect(useLaserStore.getState()).toMatchObject({ wcoCache: null, workOriginActive: false });
  const laser = useLaserStore.getState();
  if (kind === 'trace') {
    await laser.traceFrame(BOUNDS, 1000, { ...frameTraceCandidate(), returnToWorkPosition: HOME });
  } else {
    await laser.frame(BOUNDS, 1000, { ...framedRunCandidate(), returnToWorkPosition: HOME });
  }
  await acknowledgeFrameToolOffPrelude(connection);
  if (midFrameReport !== undefined) {
    connection.emitLine(midFrameReport);
    await flush();
  }
  for (let leg = 0; leg < 4; leg += 1) await acknowledgeAndSettleFrameLeg(connection);
  connection.emitLine('<Jog|MPos:0.000,0.000,0.000|FS:1000,0>');
  connection.emitLine('ok');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await acknowledgeMotionSettlement(connection);
  return { connection };
}

function startIssues(): { readonly handoff: string | null; readonly verified: boolean } {
  const state = useLaserStore.getState();
  const permit = state.framedRun;
  if (permit === null) throw new Error('Frame issued no permit');
  return {
    handoff: framedRunStartHandoffIssue(permit, state),
    verified: isVerifiedFrameValid(state.frameVerification, {
      boundsSignature: '0,0,10,10',
      wco: state.wcoCache,
      workOriginActive: state.workOriginActive,
    }),
  };
}

describe('the first WCO report around a Frame placed at the assumed zero offset', () => {
  it('issues the permit when the first report during the Frame is zero', async () => {
    await frameWithoutReportedOffset(
      '<Jog|MPos:0.000,0.000,0.000|FS:1000,0|WCO:0.000,0.000,0.000>',
    );

    const finished = useLaserStore.getState();
    expect(finished.wcoCache).toEqual({ x: 0, y: 0, z: 0 });
    expect(finished.lastWriteError).toBeNull();
    expect(startIssues()).toEqual({ handoff: null, verified: true });
  });

  it('records the split Frame trace when the first report during it is zero', async () => {
    await frameWithoutReportedOffset(
      '<Jog|MPos:0.000,0.000,0.000|FS:1000,0|WCO:0.000,0.000,0.000>',
      'trace',
    );

    const finished = useLaserStore.getState();
    expect(finished.lastWriteError).toBeNull();
    expect(finished.frameTrace?.controller.wcoCache).toEqual({ x: 0, y: 0, z: 0 });
  });

  it.each([
    ['a real XY offset', 'WCO:150.000,100.000,0.000'],
    ['a Z-only offset', 'WCO:0.000,0.000,-5.000'],
  ])('issues no permit when the first report during the Frame is %s', async (_case, wco) => {
    await frameWithoutReportedOffset(`<Jog|MPos:0.000,0.000,0.000|FS:1000,0|${wco}>`);

    const finished = useLaserStore.getState();
    expect(finished.framedRun).toBeNull();
    expect(finished.frameVerification).toBeNull();
    expect(finished.lastWriteError).toBe(FRAME_CONTROLLER_CHANGED_MESSAGE);
  });

  it('keeps the Start handoff when the first report after the Frame is zero', async () => {
    const { connection } = await frameWithoutReportedOffset();
    expect(useLaserStore.getState().wcoCache).toBeNull();

    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|WCO:0.000,0.000,0.000>');
    await flush();

    expect(useLaserStore.getState().wcoCache).toEqual({ x: 0, y: 0, z: 0 });
    expect(startIssues()).toEqual({ handoff: null, verified: true });
  });

  it('refuses the Start handoff when the first report after the Frame is a real offset', async () => {
    const { connection } = await frameWithoutReportedOffset();

    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|WCO:0.000,0.000,-5.000>');
    await flush();

    expect(startIssues()).toEqual({ handoff: FRAME_START_ORIGIN_CHANGED_MESSAGE, verified: false });
  });
});
