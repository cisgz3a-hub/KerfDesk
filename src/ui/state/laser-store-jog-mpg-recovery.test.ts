import { afterEach, describe, expect, it, vi } from 'vitest';
import { RT_JOG_CANCEL } from '../../core/controllers/grbl';
import { useLaserStore } from './laser-store';
import { jogFrameCommandBlockMessage } from './laser-store-helpers';
import {
  connectWith,
  makeConnection,
  type FakeConnection,
} from './laser-store-motion-operation.test-support';

const JOG = '$J=G91 G21 X10.000 F1000\n';
const MARKER = 'G4 P0.01\n';
const IDLE = '<Idle|MPos:10.000,0.000,0.000|FS:0,0>';
const RELEASED_IDLE = '<Idle|MPos:10.000,0.000,0.000|FS:0,0|MPG:0>';
const MPG_IDLE = '<Idle|MPos:10.000,0.000,0.000|FS:0,0|MPG:1>';
const JOGGING = '<Jog|MPos:1.000,0.000,0.000|FS:1000,0|MPG:0>';

async function flush(): Promise<void> {
  for (let index = 0; index < 40; index += 1) await Promise.resolve();
}

async function beginJog(connection: FakeConnection, writes: string[]): Promise<void> {
  await connectWith(connection);
  connection.emitLine(RELEASED_IDLE);
  writes.length = 0;
  await useLaserStore.getState().jog({ dx: 10, feed: 1000 });
  connection.emitLine(JOGGING);
}

async function completeMarker(connection: FakeConnection): Promise<void> {
  connection.emitLine('ok');
  await flush();
  connection.emitLine(IDLE);
  await flush();
}

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  vi.restoreAllMocks();
});

describe('Jog settlement after pendant/MPG release', () => {
  it('settles an acknowledged Jog after real Idle takeover without cancelling pendant motion', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await beginJog(connection, writes);
    connection.emitLine('ok');
    const operationId = useLaserStore.getState().motionOperation?.operationId;

    connection.emitLine(MPG_IDLE);
    for (let index = 0; index < 3; index += 1) connection.emitLine(IDLE);
    await flush();
    expect(writes).toEqual([JOG]);
    expect(useLaserStore.getState().motionOperation).toMatchObject({
      operationId,
      cancelRequested: true,
      interruptedByMpg: true,
    });
    expect(useLaserStore.getState().lastWriteError).toMatch(/interrupted move will not resume/);

    connection.emitLine(RELEASED_IDLE);
    await flush();
    expect(writes).toEqual([JOG, MARKER]);
    connection.emitLine(IDLE);
    expect(useLaserStore.getState().motionOperation).toMatchObject({
      operationId,
      awaitingSettlementAck: true,
    });
    await completeMarker(connection);

    expect(useLaserStore.getState().motionOperation).toBeNull();
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();
    expect(jogFrameCommandBlockMessage(useLaserStore.getState())).toBeNull();
    expect(writes).not.toContain(RT_JOG_CANCEL);
    await useLaserStore.getState().jog({ dx: 1, feed: 500 });
    expect(writes.at(-1)).toBe('$J=G91 G21 X1.000 F500\n');
  });

  it('does not mistake a late original Jog acknowledgement for the recovery marker', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await beginJog(connection, writes);
    connection.emitLine(MPG_IDLE);
    connection.emitLine(RELEASED_IDLE);
    connection.emitLine(IDLE);
    await flush();
    expect(writes).toEqual([JOG]);

    connection.emitLine('ok');
    await flush();
    expect(writes).toEqual([JOG]);
    connection.emitLine(IDLE);
    await flush();
    expect(writes).toEqual([JOG, MARKER]);
    connection.emitLine(IDLE);
    expect(useLaserStore.getState().motionOperation).not.toBeNull();
    await completeMarker(connection);
    expect(useLaserStore.getState().motionOperation).toBeNull();
  });

  it('retains the old adapter handoff through takeover and release', async () => {
    let releaseJog!: () => void;
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
      if (data === JOG)
        await new Promise<void>((resolve) => {
          releaseJog = resolve;
        });
    });
    await connectWith(connection);
    connection.emitLine(RELEASED_IDLE);
    writes.length = 0;
    const jog = useLaserStore.getState().jog({ dx: 10, feed: 1000 });
    await flush();
    connection.emitLine('ok');
    connection.emitLine(JOGGING);
    connection.emitLine(MPG_IDLE);
    connection.emitLine(RELEASED_IDLE);
    connection.emitLine(IDLE);
    await flush();
    expect(writes).toEqual([JOG]);
    expect(useLaserStore.getState().motionOperation?.pendingMotionTransportWrites).toBe(1);

    releaseJog();
    await jog;
    connection.emitLine(IDLE);
    await flush();
    expect(writes).toEqual([JOG, MARKER]);
    await completeMarker(connection);
    expect(useLaserStore.getState().motionOperation).toBeNull();
  });

  it('requires a new marker after MPG reacquires control during settlement', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await beginJog(connection, writes);
    connection.emitLine('ok');
    connection.emitLine(MPG_IDLE);
    connection.emitLine(RELEASED_IDLE);
    await flush();
    expect(writes).toEqual([JOG, MARKER]);

    connection.emitLine(MPG_IDLE);
    connection.emitLine(RELEASED_IDLE);
    connection.emitLine(IDLE);
    await flush();
    expect(writes).toEqual([JOG, MARKER]);
    connection.emitLine('ok');
    connection.emitLine(IDLE);
    await flush();
    expect(writes).toEqual([JOG, MARKER, MARKER]);
    connection.emitLine(IDLE);
    expect(useLaserStore.getState().motionOperation).not.toBeNull();
    await completeMarker(connection);
    expect(useLaserStore.getState().motionOperation).toBeNull();
    expect(writes).not.toContain(RT_JOG_CANCEL);
  });

  it('waits for pendant motion to reach Idle after MPG:0 instead of cancelling it', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await beginJog(connection, writes);
    connection.emitLine('ok');
    connection.emitLine(MPG_IDLE);
    connection.emitLine(JOGGING);
    await flush();
    expect(writes).toEqual([JOG]);
    expect(jogFrameCommandBlockMessage(useLaserStore.getState())).not.toBeNull();

    connection.emitLine(IDLE);
    await flush();
    expect(writes).toEqual([JOG, MARKER]);
    await completeMarker(connection);
    expect(useLaserStore.getState().motionOperation).toBeNull();
  });

  it('keeps explicit Cancel unavailable to pendant motion and usable after release', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await beginJog(connection, writes);
    connection.emitLine('ok');
    connection.emitLine(MPG_IDLE);

    await expect(useLaserStore.getState().cancelJog()).rejects.toThrow(/pendant\/MPG owns/);
    expect(writes).toEqual([JOG]);
    expect(useLaserStore.getState().lastWriteError).toMatch(/pendant\/MPG owns/);
    connection.emitLine(JOGGING);

    const cancel = useLaserStore.getState().cancelJog();
    await vi.waitFor(() => expect(writes).toContain('?'));
    expect(writes).toContain(RT_JOG_CANCEL);
    connection.emitLine(IDLE);
    await vi.waitFor(() => expect(writes).toContain(MARKER));
    connection.emitLine('ok');
    await flush();
    connection.emitLine(IDLE);
    await cancel;
    expect(useLaserStore.getState().motionOperation).toBeNull();
  });

  it('does not revive interrupted motion from an old connection after disconnect', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await beginJog(connection, writes);
    connection.emitLine('ok');
    connection.emitLine(MPG_IDLE);
    await useLaserStore.getState().disconnect();
    writes.length = 0;
    connection.emitLine(RELEASED_IDLE);
    connection.emitLine('ok');
    connection.emitLine(IDLE);
    await flush();

    expect(writes).toEqual([]);
    expect(useLaserStore.getState().motionOperation).toBeNull();
    expect(useLaserStore.getState().framedRun).toBeNull();
  });

  it('does not let an old recovery-marker rejection cancel a newer MPG recovery', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const writes: string[] = [];
    let rejectMarker!: (error: Error) => void;
    let delayMarker = true;
    const connection = makeConnection(async (data) => {
      writes.push(data);
      if (data === MARKER && delayMarker) {
        delayMarker = false;
        await new Promise<void>((_resolve, reject) => {
          rejectMarker = reject;
        });
      }
    });
    await beginJog(connection, writes);
    connection.emitLine('ok');
    connection.emitLine(MPG_IDLE);
    connection.emitLine(RELEASED_IDLE);
    await flush();
    expect(writes).toEqual([JOG, MARKER]);
    connection.emitLine(MPG_IDLE);
    connection.emitLine(RELEASED_IDLE);
    rejectMarker(new Error('old marker adapter rejected'));
    await flush();
    // An ambiguous old write keeps its ack debt. Its failure cannot turn the
    // later recovery back into an unstamped cancellation that never clears.
    connection.emitLine(IDLE);
    expect(writes).toEqual([JOG, MARKER]);
    connection.emitLine('ok');
    connection.emitLine(IDLE);
    await flush();
    expect(writes).toEqual([JOG, MARKER, MARKER]);
    await completeMarker(connection);
    expect(useLaserStore.getState().motionOperation).toBeNull();
    expect(useLaserStore.getState().lastWriteError).toMatch(/old marker adapter rejected/);
    expect(writes).not.toContain(RT_JOG_CANCEL);
  });
});
