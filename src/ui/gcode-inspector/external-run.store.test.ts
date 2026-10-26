// An external run through the real laser store and a scripted GRBL
// connection (ADR-630): a clean Frame records the program's Frame, Start
// streams exactly the normalized program, and the record is spent.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import type { FrameVerification } from '../state/frame-verification';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { recoveryRepository } from '../state/recovery';
import {
  acknowledgeAndSettleFrameLeg,
  acknowledgeFrameToolOffPrelude,
  acknowledgeMotionSettlement,
  connectWith,
  flush,
  makeConnection,
} from '../state/laser-store-motion-operation.test-support';
import { resetStore } from '../state/test-helpers';
import { EXTERNAL_FRAME_FIRST, externalStartIssue, startExternalProgram } from './external-run';

const GCODE = 'G21 G90\nG0 X0 Y0\nM4 S500\nG1 X10 Y10 F600\nM5\n';
const IDLE = '<Idle|MPos:0.000,0.000,0.000|FS:0,0>';

beforeEach(() => {
  resetStore();
  useStore.setState({ project: createProject() });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(initialLaserState());
  resetStore();
});

describe('external run through the laser store (ADR-630)', () => {
  it('frames, then streams exactly the framed program once', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const writes: string[] = [];
    const connection = makeConnection(async (data) => void writes.push(data), undefined, {
      autoAckStartFence: true,
    });
    await connectWith(connection);
    const verification: FrameVerification = {
      boundsSignature: 'external-program:store',
      wco: null,
      workOriginActive: false,
    };
    const envelope = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    await useLaserStore.getState().frame(envelope, 1000, undefined, undefined, undefined, {
      verification,
      returnToWorkPosition: { x: 0, y: 0 },
    });
    await acknowledgeFrameToolOffPrelude(connection);
    for (let leg = 0; leg < 5; leg += 1) await acknowledgeAndSettleFrameLeg(connection);
    await acknowledgeMotionSettlement(connection);
    expect(useLaserStore.getState().frameVerification).toBe(verification);

    const frame = {
      run: { name: 'part.nc', gcode: GCODE, envelope, start: { x: 0, y: 0, z: 0 } },
      machineKind: 'laser' as const,
      verification,
      controller: useLaserStore.getState(),
    };
    expect(externalStartIssue(frame)).toBeNull();
    // The project's last job stops being the last thing the machine ran
    // (rolling audit 2026-10-21, 05-P3-1).
    const retired = vi
      .spyOn(recoveryRepository, 'noteUntrackedRunAccepted')
      .mockResolvedValue({ ok: true, value: true });
    writes.length = 0;
    const started = startExternalProgram(frame);
    for (let tick = 0; tick < 20 && !writes.includes('?'); tick += 1) await flush();
    connection.emitLine(IDLE);
    for (let tick = 0; tick < 40 && !writes.some((data) => data.includes('M4 S500')); tick += 1) {
      await flush();
    }
    await expect(started).resolves.toBe(true);
    expect(retired).toHaveBeenCalledExactlyOnceWith();
    const sent = writes.join('');
    expect(sent).toContain(GCODE);
    expect(useLaserStore.getState().streamer).not.toBeNull();
    // One Frame, one run: Start spent the record.
    expect(useLaserStore.getState().frameVerification).toBeNull();
    expect(externalStartIssue(frame)).toBe(EXTERNAL_FRAME_FIRST);
  });
});
