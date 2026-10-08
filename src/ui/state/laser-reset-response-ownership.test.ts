import { describe, expect, it, vi } from 'vitest';
import { useLaserStore } from './laser-store';
import { startTestLaserJob } from './laser-test-start-helpers';
import {
  flush,
  connect,
  abortWithOldJobDebt,
  expectFenced,
  installResetOwnershipFixtureHooks,
} from './laser-reset-response.test-support';

installResetOwnershipFixtureHooks();

describe('causal reset response ownership', () => {
  it('keeps error-triggered reset debt fenced after a missing greeting, then recovers at a late boot', async () => {
    const f = await connect();
    await startTestLaserJob('G1 X1 S100\nG1 X2 S100');
    f.writes.length = 0;
    f.emit('error:7');
    expect(useLaserStore.getState().streamer).toMatchObject({
      status: 'errored',
      inFlight: [{ line: 'G1 X2 S100\n' }],
    });
    const notice = useLaserStore.getState().safetyNotice;
    expect(notice).toMatchObject({ kind: 'controller-error', code: 7 });
    await vi.advanceTimersByTimeAsync(600);
    expectFenced(f);
    f.emit('ok');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(useLaserStore.getState().streamer).toMatchObject({ status: 'errored', inFlight: [] });
    expect(useLaserStore.getState().safetyNotice).toBe(notice);
    expectFenced(f);
    f.emit('Grbl 1.1f');
    f.status();
    await vi.advanceTimersByTimeAsync(250);
    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
    expect(useLaserStore.getState().safetyNotice).toBe(notice);
    expect(f.writes.some((line) => line.includes('G1 X'))).toBe(false);
    expect(f.close).not.toHaveBeenCalled();
  });

  it('owns an immediate error-reset greeting before the reset write promise settles', async () => {
    const f = await connect();
    await startTestLaserJob('G1 X1 S100\nG1 X2 S100');
    f.controls.reset = 'immediate-boot';
    f.writes.length = 0;
    f.emit('error:7');
    const notice = useLaserStore.getState().safetyNotice;
    await flush();
    expect(useLaserStore.getState().streamer?.inFlight).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(300);
    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
    expect(useLaserStore.getState().safetyNotice).toBe(notice);
    f.completeReset();
    await flush();
    await vi.advanceTimersByTimeAsync(300);
    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().pendingTransportWrites).toBe(0);
    expect(f.writes.filter((line) => line === '\x18')).toHaveLength(1);
    expect(f.writes.filter((line) => line === 'M5\n')).toHaveLength(1);
    expect(f.writes.filter((line) => line === 'M9\n')).toHaveLength(1);
    expect(f.writes.filter((line) => line === '$$\n')).toHaveLength(1);
    expect(f.close).not.toHaveBeenCalled();
  });

  it('keeps missing-greeting Abort fenced even after all old job ACKs drain', async () => {
    const f = await connect();
    await abortWithOldJobDebt(f);
    await vi.advanceTimersByTimeAsync(600);
    expectFenced(f);
    f.emit('ok');
    f.emit('ok');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(useLaserStore.getState().streamer?.inFlight).toHaveLength(0);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(useLaserStore.getState().pendingTransportWrites).toBe(0);
    expectFenced(f);
    await expect(useLaserStore.getState().retryControllerQualification()).rejects.toThrow('reset');
  });

  it('keeps an actual non-job owed reply fenced after its late anonymous ACK drains', async () => {
    const f = await connect();
    await useLaserStore.getState().sendConsoleCommand('G4 P0.01', { confirmed: true });
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    await useLaserStore.getState().stopJob();
    await vi.advanceTimersByTimeAsync(600);
    expectFenced(f);
    f.emit('ok');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expectFenced(f);
  });

  it('uses a late recognized boot to discard old stream debt before cleanup and settings ACKs', async () => {
    const f = await connect();
    await abortWithOldJobDebt(f);
    await vi.advanceTimersByTimeAsync(600);
    expectFenced(f);
    f.controls.cleanupAck = false;
    f.emit('Grbl 1.1f');
    f.status();
    await flush();
    expect(useLaserStore.getState().streamer?.inFlight).toHaveLength(0);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(2);
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    f.emit('ok');
    await vi.advanceTimersByTimeAsync(100);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    expect(f.writes).not.toContain('$$\n');
    f.emit('ok');
    await vi.advanceTimersByTimeAsync(250);
    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
    expect(f.writes.filter((line) => line === '$$\n')).toHaveLength(1);
    expect(f.close).not.toHaveBeenCalled();
  });

  it.each(['rejected', 'hung'])(
    'keeps %s reset delivery fenced through healthy Idle and old ACKs',
    async (reset) => {
      const f = await connect();
      await startTestLaserJob('G1 X1 S100\nG1 X2 S100');
      f.writes.length = 0;
      f.controls.reset = reset;
      const stop = useLaserStore
        .getState()
        .stopJob()
        .catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(600);
      expect(await stop).toBeInstanceOf(Error);
      expectFenced(f);
      f.completeReset();
      await flush();
      f.emit('ok');
      f.emit('ok');
      f.status();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(useLaserStore.getState().pendingTransportWrites).toBe(0);
      expectFenced(f);
    },
  );

  it.each([
    ['Alarm', 50],
    ['Sleep', 50],
    ['Alarm', 600],
    ['Sleep', 600],
    ['ALARM:2', 50],
    ['ALARM:2', 600],
  ])(
    'preserves the exact reset fence through %s at %i ms and recovers after late boot',
    async (state, delay) => {
      const f = await connect();
      await abortWithOldJobDebt(f);
      const owner = useLaserStore.getState().controllerOperation;
      await vi.advanceTimersByTimeAsync(Number(delay));
      if (String(state).startsWith('ALARM:')) {
        f.emit(String(state));
      } else {
        f.controls.state = String(state);
        f.status();
      }
      await vi.advanceTimersByTimeAsync(600);
      expect(useLaserStore.getState().controllerOperation).toBe(owner);
      expectFenced(f);
      await expect(useLaserStore.getState().wakeController()).rejects.toThrow(
        'already awaiting its startup response',
      );
      expect(useLaserStore.getState().controllerOperation).toBe(owner);
      f.emit('ok');
      f.emit('ok');
      f.controls.state = 'Idle';
      f.status();
      await vi.advanceTimersByTimeAsync(1_000);
      expectFenced(f);
      f.emit('Grbl 1.1f');
      f.status();
      await vi.advanceTimersByTimeAsync(250);
      expect(useLaserStore.getState().controllerOperation).toBeNull();
      expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
      expect(f.close).not.toHaveBeenCalled();
    },
  );

  it('joins a later Disconnect without a second reset or duplicate cleanup', async () => {
    const f = await connect();
    await abortWithOldJobDebt(f);
    await vi.advanceTimersByTimeAsync(600);
    expectFenced(f);
    await useLaserStore.getState().disconnect();
    expect(f.writes.filter((line) => line === '\x18')).toHaveLength(1);
    expect(f.writes.filter((line) => line === 'M5\n')).toHaveLength(1);
    expect(f.writes.filter((line) => line === 'M9\n')).toHaveLength(1);
    expect(f.close).toHaveBeenCalledOnce();
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
  });

  it('makes bounded off attempts after rejected reset during Run while keeping every old and cleanup reply fenced', async () => {
    const f = await connect();
    await startTestLaserJob('G1 X1 S100\nG1 X2 S100');
    f.controls.state = 'Run';
    f.status();
    f.controls.cleanupAck = false;
    f.controls.reset = 'rejected';
    f.writes.length = 0;
    await expect(useLaserStore.getState().stopJob()).rejects.toThrow('Reset transport rejected');
    const notice = useLaserStore.getState().safetyNotice;
    const owner = useLaserStore.getState().controllerOperation;
    await vi.advanceTimersByTimeAsync(600);
    expectFenced(f);
    expect(useLaserStore.getState().streamer).toMatchObject({
      status: 'errored',
      inFlight: [{ line: 'G1 X1 S100\n' }, { line: 'G1 X2 S100\n' }],
    });
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(2);
    f.emit('ok');
    f.emit('ok');
    expect(useLaserStore.getState().streamer?.inFlight).toHaveLength(0);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(2);
    f.controls.state = 'Idle';
    f.status();
    await vi.advanceTimersByTimeAsync(1_000);
    expectFenced(f);
    f.emit('ok');
    f.emit('ok');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(useLaserStore.getState().controllerOperation).toBe(owner);
    expectFenced(f);
    await expect(
      useLaserStore.getState().frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000),
    ).rejects.toThrow('A job is active');
    f.controls.cleanupAck = true;
    f.emit('Grbl 1.1f');
    f.status();
    await vi.advanceTimersByTimeAsync(250);
    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
    expect(useLaserStore.getState().safetyNotice).toBe(notice);
    expect(f.writes.filter((line) => line === 'M5\n')).toHaveLength(2);
    expect(f.writes.filter((line) => line === 'M9\n')).toHaveLength(2);
    expect(f.writes.some((line) => line.includes('G1 X'))).toBe(false);
  });

  it('keeps a replacement Abort ambiguous after an off failure and every anonymous reply has drained', async () => {
    const f = await connect();
    f.controls.cleanupAck = false;
    await abortWithOldJobDebt(f);
    f.controls.rejectNextM5 = true;
    await vi.advanceTimersByTimeAsync(600);
    expect(useLaserStore.getState().controllerQualification.kind).toBe('failed');
    const oldOwner = useLaserStore.getState().controllerOperation;
    const notice = useLaserStore.getState().safetyNotice;
    for (let index = 0; index < 8; index++) f.emit('ok');
    f.status();
    await flush();
    expect(useLaserStore.getState().streamer?.inFlight).toHaveLength(0);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(useLaserStore.getState().pendingTransportWrites).toBe(0);
    await useLaserStore.getState().stopJob();
    const owner = useLaserStore.getState().controllerOperation;
    expect(owner).not.toBe(oldOwner);
    await vi.advanceTimersByTimeAsync(600);
    for (let index = 0; index < 4; index++) f.emit('ok');
    f.status();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.writes.filter((line) => line === '\x18')).toHaveLength(2);
    expect(useLaserStore.getState().controllerOperation).toBe(owner);
    expect(useLaserStore.getState().controllerQualification.kind).toBe('failed');
    expect(f.writes).not.toContain('$$\n');
    await expect(
      useLaserStore.getState().frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000),
    ).rejects.toThrow('controller operation is active');
    f.controls.cleanupAck = true;
    f.emit('Grbl 1.1f');
    f.status();
    await vi.advanceTimersByTimeAsync(250);
    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
    expect(useLaserStore.getState().safetyNotice).toBe(notice);
    expect(f.close).not.toHaveBeenCalled();
  });

  it('adopts the same-port Disconnect writer when teardown replaces the original Abort attempt', async () => {
    const f = await connect();
    await abortWithOldJobDebt(f);
    const disconnect = useLaserStore.getState().disconnect();
    await flush();
    f.emit('Grbl 1.1f');
    await disconnect;
    expect(f.writes.filter((line) => line === '\x18')).toHaveLength(1);
    expect(f.writes.filter((line) => line === 'M5\n')).toHaveLength(1);
    expect(f.writes.filter((line) => line === 'M9\n')).toHaveLength(1);
    expect(f.close).toHaveBeenCalledOnce();
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
  });

  it('never releases a different reset operation merely because old owned cleanup succeeds', async () => {
    const f = await connect();
    await abortWithOldJobDebt(f);
    await vi.advanceTimersByTimeAsync(600);
    const replacement = { kind: 'recovery', phase: 'reset', idleReports: 0 } as const;
    useLaserStore.setState({ controllerOperation: replacement });
    f.emit('Grbl 1.1f');
    f.status();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(useLaserStore.getState().controllerOperation).toBe(replacement);
    expect(f.writes).not.toContain('$$\n');
  });
});
