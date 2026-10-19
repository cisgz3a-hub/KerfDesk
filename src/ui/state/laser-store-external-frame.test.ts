// An external G-code program's Frame (ADR-630) passes no run candidate, only
// a Frame record. A clean completion stores that exact record and mints no
// project permit; an interrupted Frame stores nothing.

import { afterEach, describe, expect, it } from 'vitest';
import type { FrameVerification } from './frame-verification';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { resetStore } from './test-helpers';
import {
  acknowledgeAndSettleFrameLeg,
  acknowledgeFrameToolOffPrelude,
  acknowledgeMotionSettlement,
  connectWith,
  makeConnection,
} from './laser-store-motion-operation.test-support';

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(initialLaserState());
  resetStore();
});

const BOUNDS = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

function record(): FrameVerification {
  return { boundsSignature: 'external-program:test', wco: null, workOriginActive: false };
}

describe('external program Frame record (ADR-630)', () => {
  it('stores the exact record after a clean Frame and issues no project permit', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    const verification = record();
    await useLaserStore.getState().frame(BOUNDS, 1000, undefined, undefined, undefined, {
      verification,
      returnToWorkPosition: { x: 0, y: 0 },
    });
    await acknowledgeFrameToolOffPrelude(connection);
    // The move to the first corner, then the four sides.
    for (let leg = 0; leg < 5; leg += 1) await acknowledgeAndSettleFrameLeg(connection);
    await acknowledgeMotionSettlement(connection);
    const state = useLaserStore.getState();
    expect(state.motionOperation).toBeNull();
    expect(state.frameVerification).toBe(verification);
    expect(state.framedRun).toBeNull();
  });

  it('stores nothing when the controller refuses a Frame move', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    const verification = record();
    await useLaserStore.getState().frame(BOUNDS, 1000, undefined, undefined, undefined, {
      verification,
      returnToWorkPosition: { x: 0, y: 0 },
    });
    await acknowledgeFrameToolOffPrelude(connection);
    // error:15 is GRBL's jog target beyond the machine's travel.
    connection.emitLine('error:15');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await acknowledgeMotionSettlement(connection);
    expect(useLaserStore.getState().frameVerification).toBeNull();
  });
});
