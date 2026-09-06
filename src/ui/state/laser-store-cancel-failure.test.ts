import { afterEach, describe, expect, it, vi } from 'vitest';
import { RT_JOG_CANCEL } from '../../core/controllers/grbl';
import { useLaserStore } from './laser-store';
import {
  connectWith,
  makeConnection,
  setMotionOperation,
} from './laser-store-motion-operation.test-support';

const IDLE = '<Idle|MPos:10.000,0.000,0.000|FS:0,0|MPG:0>';
const MPG_IDLE = '<Idle|MPos:10.000,0.000,0.000|FS:0,0|MPG:1>';
const MARKER = 'G4 P0.01\n';

async function flush(): Promise<void> {
  for (let index = 0; index < 40; index += 1) await Promise.resolve();
}

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  vi.restoreAllMocks();
});

describe('visible cancellation settlement failures', () => {
  it('publishes the old Jog acknowledgement timeout after a successful cancel write', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    connection.emitLine(IDLE);
    await useLaserStore.getState().jog({ dx: 10, feed: 1000 });
    useLaserStore.setState({ lastWriteError: null, safetyNotice: null });
    vi.useFakeTimers();

    const cancel = useLaserStore.getState().cancelJog();
    const rejection = expect(cancel).rejects.toThrow(/previous motion command acknowledgement/);
    await vi.advanceTimersByTimeAsync(8010);
    await rejection;

    expect(writes).toContain(RT_JOG_CANCEL);
    expect(useLaserStore.getState().lastWriteError).toMatch(
      /previous motion command acknowledgement/,
    );
    expect(useLaserStore.getState().log.at(-1)).toContain('Motion cancellation needs attention');
    expect(useLaserStore.getState().motionOperation).toMatchObject({ cancelRequested: true });
    expect(useLaserStore.getState().framedRun).toBeNull();
  });

  it.each([
    ['initial status', /Timed out waiting for controller state after Cancel/],
    ['marker acknowledgement', /motion-cancel settle marker timed out/],
    ['final status', /post-cancel Idle status report/],
  ] as const)(
    'publishes a %s timeout without claiming completed motion',
    async (phase, expected) => {
      const writes: string[] = [];
      const connection = makeConnection(async (data) => {
        writes.push(data);
      });
      await connectWith(connection);
      connection.emitLine(IDLE);
      setMotionOperation({ kind: 'jog', sawControllerBusy: true });
      useLaserStore.setState({ lastWriteError: null, safetyNotice: null });
      writes.length = 0;
      vi.useFakeTimers();

      const cancel = useLaserStore.getState().cancelJog();
      const rejection = expect(cancel).rejects.toThrow(expected);
      await flush();
      expect(writes).toEqual([RT_JOG_CANCEL, '?']);
      if (phase !== 'initial status') {
        connection.emitLine(IDLE);
        await flush();
        expect(writes).toContain(MARKER);
      }
      if (phase === 'final status') {
        connection.emitLine('ok');
        await flush();
        expect(writes.filter((line) => line === '?')).toHaveLength(2);
      }
      await vi.advanceTimersByTimeAsync(8010);
      await rejection;

      expect(useLaserStore.getState().lastWriteError).toMatch(expected);
      expect(useLaserStore.getState().motionOperation).toMatchObject({ cancelRequested: true });
      expect(useLaserStore.getState().framedRun).toBeNull();
    },
  );

  it('does not send a marker or a second cancel after MPG takes over during the query', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    connection.emitLine(IDLE);
    setMotionOperation({ kind: 'jog', sawControllerBusy: true });
    writes.length = 0;

    const cancel = useLaserStore.getState().cancelJog();
    const rejection = expect(cancel).rejects.toThrow(/interrupted/);
    await flush();
    expect(writes).toEqual([RT_JOG_CANCEL, '?']);
    connection.emitLine(MPG_IDLE);
    await rejection;
    expect(writes).toEqual([RT_JOG_CANCEL, '?']);
    expect(useLaserStore.getState().lastWriteError).toMatch(/interrupted move will not resume/);
    expect(useLaserStore.getState().motionOperation).toMatchObject({ interruptedByMpg: true });

    connection.emitLine(IDLE);
    await flush();
    expect(writes).toEqual([RT_JOG_CANCEL, '?', MARKER]);
    connection.emitLine('ok');
    connection.emitLine(IDLE);
    expect(useLaserStore.getState().motionOperation).toBeNull();
  });

  it('does not stamp completion from a pending marker after MPG reacquires control', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    connection.emitLine(IDLE);
    setMotionOperation({ kind: 'jog', sawControllerBusy: true });
    writes.length = 0;

    const cancel = useLaserStore.getState().cancelJog();
    const rejection = expect(cancel).rejects.toThrow(/interrupted/);
    await flush();
    connection.emitLine(IDLE);
    await flush();
    expect(writes).toEqual([RT_JOG_CANCEL, '?', MARKER]);
    connection.emitLine(MPG_IDLE);
    connection.emitLine('ok');
    await rejection;
    expect(writes).toEqual([RT_JOG_CANCEL, '?', MARKER]);
    expect(
      useLaserStore.getState().motionOperation?.cancelStatusQueryAfterSequence,
    ).toBeUndefined();
    expect(useLaserStore.getState().motionOperation).toMatchObject({ interruptedByMpg: true });
  });

  it('does not publish an old cancel write failure into a replacement connection', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let rejectOldCancel!: (error: Error) => void;
    let delayCancel = false;
    const oldConnection = makeConnection(async (data) => {
      if (data === RT_JOG_CANCEL && delayCancel) {
        delayCancel = false;
        await new Promise<void>((_resolve, reject) => {
          rejectOldCancel = reject;
        });
      }
    });
    await connectWith(oldConnection);
    oldConnection.emitLine(IDLE);
    setMotionOperation({ kind: 'jog', sawControllerBusy: true });
    delayCancel = true;
    const cancel = useLaserStore.getState().cancelJog();
    const rejection = expect(cancel).rejects.toThrow(/old cancel write failed/);
    await flush();

    await useLaserStore.getState().disconnect();
    const newWrites: string[] = [];
    const newConnection = makeConnection(async (data) => {
      newWrites.push(data);
    });
    await connectWith(newConnection);
    newConnection.emitLine(IDLE);
    newWrites.length = 0;
    useLaserStore.setState({ lastWriteError: 'Replacement connection notice' });
    rejectOldCancel(new Error('old cancel write failed'));
    await rejection;

    expect(newWrites).toEqual([]);
    expect(useLaserStore.getState().lastWriteError).toBe('Replacement connection notice');
    expect(useLaserStore.getState().motionOperation).toBeNull();
  });

  it('keeps MPG guidance alongside an old in-flight cancel adapter failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const writes: string[] = [];
    let rejectCancel!: (error: Error) => void;
    const connection = makeConnection(async (data) => {
      writes.push(data);
      if (data === RT_JOG_CANCEL) {
        await new Promise<void>((_resolve, reject) => {
          rejectCancel = reject;
        });
      }
    });
    await connectWith(connection);
    connection.emitLine(IDLE);
    setMotionOperation({ kind: 'jog', sawControllerBusy: true });
    writes.length = 0;
    const cancel = useLaserStore.getState().cancelJog();
    const rejection = expect(cancel).rejects.toThrow('delayed cancel write failed');
    await flush();
    connection.emitLine(MPG_IDLE);
    rejectCancel(new Error('delayed cancel write failed'));
    await rejection;

    expect(writes).toEqual([RT_JOG_CANCEL]);
    expect(useLaserStore.getState().lastWriteError).toMatch(/delayed cancel write failed/);
    expect(useLaserStore.getState().lastWriteError).toMatch(/Return control to KerfDesk/);
    expect(useLaserStore.getState().safetyNotice).toMatchObject({
      kind: 'write-failed',
      action: 'jog',
    });
    expect(useLaserStore.getState().motionOperation).toMatchObject({ interruptedByMpg: true });
  });
});
