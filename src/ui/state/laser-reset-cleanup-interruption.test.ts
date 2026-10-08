import { captureTestLaserStartFenceAck, startTestLaserJob } from './laser-test-start-helpers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { framedRunCandidate } from './laser-store-motion-operation.test-support';

async function flush(): Promise<void> {
  for (let index = 0; index < 96; index++) await Promise.resolve();
}

function fixture() {
  const writes: string[] = [];
  const listeners = new Set<(line: string) => void>();
  const closeListeners = new Set<() => void>();
  const controls = { state: 'Idle', holdNextM5: false, cleanupAck: true };
  let releaseM5 = (): void => undefined;
  const emit = (line: string): void => {
    for (const listener of listeners) listener(line);
  };
  const status = (): void => emit(`<${controls.state}|MPos:0,0,0|FS:0,0>`);
  const connection: SerialConnection = {
    write: async (data) => {
      const acknowledgeStartFence = captureTestLaserStartFenceAck(data, emit);
      writes.push(data);
      if (data === 'M5\n' && controls.holdNextM5) {
        controls.holdNextM5 = false;
        await new Promise<void>((resolve) => {
          releaseM5 = resolve;
        });
      }
      if (data === '?') status();
      if (data === '$I\n') {
        emit('[VER:1.1h.20190830:test]');
        emit('[OPT:VM,15,128]');
        emit('ok');
      }
      if (data === '$G\n') {
        emit('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
        emit('ok');
      }
      if (data === '$$\n') {
        emit('$30=1000');
        emit('$31=0');
        emit('$32=1');
        emit('ok');
      }
      if (controls.cleanupAck && (data === 'M5\n' || data === 'M9\n')) emit('ok');
      acknowledgeStartFence();
    },
    onLine: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onClose: (listener) => {
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
    close: async () => undefined,
  };
  const adapter: PlatformAdapter = {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: async () => ({ open: async () => connection }),
    },
  };
  return {
    adapter,
    writes,
    controls,
    emit,
    status,
    releaseM5: () => releaseM5(),
    drop: () => {
      for (const listener of closeListeners) listener();
    },
  };
}

let current: ReturnType<typeof fixture> | null = null;

async function connect() {
  const f = fixture();
  current = f;
  await useLaserStore.getState().connect(f.adapter);
  f.emit('Grbl 1.1f');
  f.status();
  await flush();
  await vi.advanceTimersByTimeAsync(100);
  expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
  f.writes.length = 0;
  return f;
}

async function beginHeldCleanup(f: ReturnType<typeof fixture>) {
  await useLaserStore.getState().stopJob();
  const owner = useLaserStore.getState().controllerOperation;
  expect(owner).toMatchObject({ kind: 'recovery', phase: 'reset' });
  f.controls.holdNextM5 = true;
  f.emit('Grbl 1.1f');
  await flush();
  expect(f.writes).toEqual(['\x18', 'M5\n']);
  expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
  expect(useLaserStore.getState().pendingTransportWrites).toBe(1);
  return owner;
}

function interrupt(f: ReturnType<typeof fixture>, report: string): void {
  if (report.startsWith('ALARM:')) {
    f.controls.state = 'Alarm';
    f.emit(report);
  } else {
    f.controls.state = report;
    f.status();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  useLaserStore.setState(initialLaserState());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  current?.drop();
  current?.releaseM5();
  current = null;
  await flush();
  useLaserStore.setState(initialLaserState());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('post-reset cleanup interrupted while its transport is pending', () => {
  it('keeps a late boot ambiguous while a pre-boundary off write still crosses transport', async () => {
    const f = await connect();
    await startTestLaserJob('G1 X1 S100\nG1 X2 S100');
    f.writes.length = 0;
    f.controls.cleanupAck = false;
    f.controls.holdNextM5 = true;
    await useLaserStore.getState().stopJob();
    const owner = useLaserStore.getState().controllerOperation;
    await vi.advanceTimersByTimeAsync(600);
    expect(f.writes.filter((line) => line === 'M5\n')).toHaveLength(1);
    expect(f.writes).not.toContain('M9\n');
    f.emit('Grbl 1.1f');
    f.status();
    await vi.advanceTimersByTimeAsync(250);
    expect(useLaserStore.getState().controllerOperation).toBe(owner);
    expect(useLaserStore.getState().controllerQualification.kind).toBe('failed');
    expect(f.writes).not.toContain('$$\n');
    f.releaseM5();
    await flush();
    for (let index = 0; index < 4; index++) f.emit('ok');
    f.status();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(useLaserStore.getState().controllerOperation).toBe(owner);
    expect(f.writes).not.toContain('$$\n');
    await expect(
      useLaserStore
        .getState()
        .frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, framedRunCandidate()),
    ).rejects.toThrow('controller operation is active');
    f.controls.cleanupAck = true;
    f.emit('Grbl 1.1f');
    f.status();
    await vi.advanceTimersByTimeAsync(250);
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
    expect(f.writes.filter((line) => line === '\x18')).toHaveLength(1);
    expect(f.writes.filter((line) => line === 'M5\n')).toHaveLength(3);
    expect(f.writes.filter((line) => line === 'M9\n')).toHaveLength(2);
    expect(f.writes.some((line) => line.includes('G1 X'))).toBe(false);
  });

  it('keeps an interrupted cleanup fenced when a second boot arrives before M5 transport settles', async () => {
    const f = await connect();
    const owner = await beginHeldCleanup(f);
    f.emit('Grbl 1.1f');
    expect(useLaserStore.getState().controllerOperation).toBe(owner);
    f.releaseM5();
    await flush();
    f.status();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(useLaserStore.getState().controllerOperation).toBe(owner);
    expect(useLaserStore.getState().controllerQualification.kind).toBe('failed');
    expect(f.writes.filter((line) => line === '\x18')).toHaveLength(1);
    expect(f.writes.filter((line) => line === 'M5\n')).toHaveLength(1);
    expect(f.writes.filter((line) => line === 'M9\n')).toHaveLength(1);
    expect(f.writes).not.toContain('$$\n');
    await expect(
      useLaserStore
        .getState()
        .frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, framedRunCandidate()),
    ).rejects.toThrow('controller operation is active');
    f.writes.length = 0;
    await useLaserStore.getState().stopJob();
    expect(f.writes.filter((line) => line === '\x18')).toHaveLength(1);
    expect(useLaserStore.getState().controllerOperation).not.toBe(owner);
  });

  it.each(['Alarm', 'Sleep', 'ALARM:2'])(
    'retains cleanup ownership and its real reply debt through %s',
    async (report) => {
      const f = await connect();
      const owner = await beginHeldCleanup(f);
      interrupt(f, report);

      expect(useLaserStore.getState().controllerOperation).toBe(owner);
      expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
      expect(useLaserStore.getState().pendingTransportWrites).toBe(1);
      expect(f.writes).not.toContain('$$\n');
    },
  );

  it.each(['Alarm', 'Sleep', 'ALARM:2'])(
    'never reuses the old reset to Abort a fresh Frame after %s interrupts cleanup',
    async (report) => {
      const f = await connect();
      const owner = await beginHeldCleanup(f);
      interrupt(f, report);
      f.releaseM5();
      await flush();
      f.controls.state = 'Idle';
      f.status();
      await vi.advanceTimersByTimeAsync(1_000);
      f.controls.cleanupAck = false;
      f.writes.length = 0;
      const state = useLaserStore.getState();

      // Both permitted outcomes preserve causality: an unresolved cleanup
      // blocks new motion, or recovered controls own every subsequent Abort.
      if (state.controllerOperation !== null) {
        expect(state.controllerOperation).toBe(owner);
        await expect(
          state.frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, framedRunCandidate()),
        ).rejects.toThrow('controller operation is active');
        expect(f.writes).toEqual([]);
        return;
      }

      expect(state.controllerQualification.kind).toBe('qualified');
      await state.frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, framedRunCandidate());
      expect(f.writes).toEqual(['M5\n']);
      expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
      f.writes.length = 0;
      await useLaserStore.getState().stopJob();
      expect(f.writes.filter((line) => line === '\x18')).toHaveLength(1);
      expect(useLaserStore.getState().motionOperation).toBeNull();
      f.emit('ok');
      f.status();
      await flush();
      expect(f.writes.some((line) => line.startsWith('$J=') || line.startsWith('G1'))).toBe(false);
    },
  );

  it.each(['Alarm', 'Sleep', 'ALARM:2'])(
    'keeps delayed successful cleanup replies owed through %s and owns the next Frame Abort',
    async (report) => {
      const f = await connect();
      const owner = await beginHeldCleanup(f);
      f.controls.cleanupAck = false;
      interrupt(f, report);
      expect(useLaserStore.getState().controllerOperation).toBe(owner);
      f.releaseM5();
      await flush();
      expect(useLaserStore.getState().pendingUntrackedAcks).toBe(2);
      expect(useLaserStore.getState().pendingTransportWrites).toBe(0);
      expect(useLaserStore.getState().controllerOperation).toBeNull();
      f.controls.state = 'Idle';
      f.status();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(f.writes).not.toContain('$$\n');
      expect(useLaserStore.getState().controllerQualification.kind).toBe('qualifying');
      f.emit('ok');
      await vi.advanceTimersByTimeAsync(100);
      expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
      expect(f.writes).not.toContain('$$\n');
      f.emit('ok');
      await vi.advanceTimersByTimeAsync(100);
      expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
      expect(f.writes.filter((line) => line === '$$\n')).toHaveLength(1);
      f.writes.length = 0;
      await useLaserStore
        .getState()
        .frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, framedRunCandidate());
      expect(f.writes).toEqual(['M5\n']);
      f.writes.length = 0;
      await useLaserStore.getState().stopJob();
      expect(f.writes.filter((line) => line === '\x18')).toHaveLength(1);
      expect(useLaserStore.getState().motionOperation).toBeNull();
      f.emit('ok');
      f.status();
      await flush();
      expect(f.writes.some((line) => line.startsWith('$J=') || line.startsWith('G1'))).toBe(false);
    },
  );
});
