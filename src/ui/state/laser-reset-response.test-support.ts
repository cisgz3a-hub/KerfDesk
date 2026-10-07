import { afterEach, beforeEach, expect, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { captureTestLaserStartFenceAck, startTestLaserJob } from './laser-test-start-helpers';

export async function flush(): Promise<void> {
  for (let index = 0; index < 96; index++) await Promise.resolve();
}

function fixture() {
  const writes: string[] = [];
  const listeners = new Set<(line: string) => void>();
  const closeListeners = new Set<() => void>();
  const controls = { state: 'Idle', reset: 'accepted', cleanupAck: true, rejectNextM5: false };
  let completeReset = (): void => undefined;
  const emit = (line: string): void => {
    for (const listener of listeners) listener(line);
  };
  const status = (): void => emit(`<${controls.state}|MPos:0,0,0|FS:0,0>`);
  const resetWrite = async (): Promise<void> => {
    if (controls.reset === 'rejected') throw new Error('Reset transport rejected.');
    if (controls.reset === 'immediate-boot') {
      emit('Grbl 1.1f');
      status();
    }
    if (controls.reset === 'hung' || controls.reset === 'immediate-boot') {
      await new Promise<void>((resolve) => {
        completeReset = resolve;
      });
    }
  };
  const close = vi.fn(async () => undefined);
  const connection: SerialConnection = {
    write: async (data) => {
      const acknowledgeStartFence = captureTestLaserStartFenceAck(data, emit);
      writes.push(data);
      if (data === 'M5\n' && controls.rejectNextM5) {
        controls.rejectNextM5 = false;
        throw new Error('Beam-off transport rejected.');
      }
      if (data === '\x18') await resetWrite();
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
    close,
  };
  return {
    writes,
    controls,
    emit,
    status,
    close,
    adapter: adapterFor(connection),
    completeReset: () => completeReset(),
    drop: () => {
      for (const listener of closeListeners) listener();
    },
  };
}

function adapterFor(connection: SerialConnection): PlatformAdapter {
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

let current: ReturnType<typeof fixture> | null = null;

export async function connect(): Promise<ReturnType<typeof fixture>> {
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

export async function abortWithOldJobDebt(f: ReturnType<typeof fixture>): Promise<void> {
  await startTestLaserJob('G1 X1 S100\nG1 X2 S100');
  expect(useLaserStore.getState().streamer?.inFlight).toHaveLength(2);
  f.writes.length = 0;
  await useLaserStore.getState().stopJob();
}

export function expectFenced(f: ReturnType<typeof fixture>): void {
  expect(useLaserStore.getState()).toMatchObject({
    connection: { kind: 'connected' },
    controllerOperation: { kind: 'recovery', phase: 'reset' },
    controllerQualification: {
      kind: 'failed',
      message: expect.stringContaining('reset was not confirmed'),
    },
  });
  expect(f.writes.filter((line) => line === '\x18')).toHaveLength(1);
  expect(f.writes.filter((line) => line === 'M5\n')).toHaveLength(1);
  expect(f.writes.filter((line) => line === 'M9\n')).toHaveLength(1);
  expect(f.writes).not.toContain('$$\n');
  expect(f.close).not.toHaveBeenCalled();
}

export function installResetOwnershipFixtureHooks(): void {
  beforeEach(() => {
    vi.useFakeTimers();
    useLaserStore.setState(initialLaserState());
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    current?.drop();
    current = null;
    await flush();
    useLaserStore.setState(initialLaserState());
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
}
