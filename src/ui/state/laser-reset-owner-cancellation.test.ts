import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProbeRequest } from '../../core/controllers/grbl/probe';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { framedRunCandidate } from './laser-store-motion-operation.test-support';

const Z_REQUEST = {
  kind: 'z',
  params: {
    plateThicknessMm: 15,
    seekFeedMmPerMin: 150,
    probeFeedMmPerMin: 25,
    maxTravelMm: 25,
    retractMm: 5,
  },
} satisfies ProbeRequest;

async function flush(): Promise<void> {
  for (let index = 0; index < 96; index++) await Promise.resolve();
}

function fixture(initialStatus: string, hosted = false) {
  const writes: string[] = [];
  const lineListeners = new Set<(line: string) => void>();
  const closeListeners = new Set<() => void>();
  const controls = {
    state: initialStatus,
    reset: 'accepted',
    cleanupAck: true,
    rejectProbe: false,
    holdHostedRelease: false,
  };
  let completeReset = (): void => undefined;
  let releaseHosted = (): void => undefined;
  const emit = (line: string): void => {
    for (const listener of lineListeners) listener(line);
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
  const write = async (data: string): Promise<void> => {
    writes.push(data);
    switch (data) {
      case '\x18':
        await resetWrite();
        break;
      case '?':
        status();
        break;
      case '$I\n':
        emit('[VER:1.1h.20190830:test]');
        emit('[OPT:VM,15,128]');
        emit('ok');
        break;
      case '$G\n':
        emit('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
        emit('ok');
        break;
      case '$$\n':
        emit('$30=1000');
        emit('$31=0');
        emit('$32=1');
        emit('ok');
        break;
      case 'M5\n':
      case 'M9\n':
        if (controls.cleanupAck) emit('ok');
        break;
      case 'G54\n':
        if (controls.rejectProbe) emit('error:20');
        break;
    }
  };
  const connection: SerialConnection = {
    ...(hosted
      ? {
          hostedStreaming: {
            arm: async () => undefined,
            isArmed: () => false,
            onWriteError: () => () => undefined,
            release: async () => {
              if (controls.holdHostedRelease) {
                controls.holdHostedRelease = false;
                await new Promise<void>((resolve) => {
                  releaseHosted = resolve;
                });
              }
            },
          },
        }
      : {}),
    write,
    onLine: (listener) => {
      lineListeners.add(listener);
      return () => lineListeners.delete(listener);
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
    completeReset: () => completeReset(),
    releaseHosted: () => releaseHosted(),
    drop: () => {
      for (const listener of closeListeners) listener();
    },
  };
}

let current: ReturnType<typeof fixture> | null = null;

async function connect(
  initialStatus = 'Idle',
  hosted = false,
): Promise<ReturnType<typeof fixture>> {
  const f = fixture(initialStatus, hosted);
  current = f;
  await useLaserStore.getState().connect(f.adapter);
  f.emit('Grbl 1.1f');
  f.status();
  await flush();
  await vi.advanceTimersByTimeAsync(100);
  f.writes.length = 0;
  return f;
}

function expectNoCleanup(f: ReturnType<typeof fixture>): void {
  expect(f.writes).not.toContain('M5\n');
  expect(f.writes).not.toContain('M9\n');
  expect(f.writes).not.toContain('$$\n');
}

beforeEach(() => {
  vi.useFakeTimers();
  useLaserStore.setState(initialLaserState());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  current?.releaseHosted();
  current?.completeReset();
  const disconnect = useLaserStore.getState().disconnect();
  await vi.advanceTimersByTimeAsync(1_000);
  await disconnect;
  current?.drop();
  current = null;
  await flush();
  useLaserStore.setState(initialLaserState());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Abort preserves its reset owner against stale lifecycle callbacks', () => {
  it('releases a booted owner before a fresh Frame and keeps its delayed continuation away from the next Abort', async () => {
    const f = await connect();
    f.controls.reset = 'immediate-boot';
    let firstStopFinished = false;
    const firstStop = useLaserStore
      .getState()
      .stopJob()
      .then(() => {
        firstStopFinished = true;
      });
    await flush();
    expect(firstStopFinished).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    f.controls.cleanupAck = false;
    f.writes.length = 0;
    await useLaserStore
      .getState()
      .frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, framedRunCandidate());
    expect(f.writes).toEqual(['M5\n']);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    f.controls.reset = 'accepted';
    f.writes.length = 0;
    await useLaserStore.getState().stopJob();
    const secondOwner = useLaserStore.getState().controllerOperation;
    expect(secondOwner).toMatchObject({ kind: 'recovery', phase: 'reset' });
    expect(f.writes).toEqual(['\x18']);
    expect(useLaserStore.getState().motionOperation).toBeNull();
    await vi.advanceTimersByTimeAsync(200);
    await firstStop;
    expect(useLaserStore.getState().controllerOperation).toBe(secondOwner);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    expectNoCleanup(f);
    f.completeReset();
    await flush();
    expect(useLaserStore.getState().controllerOperation).toBe(secondOwner);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    await vi.advanceTimersByTimeAsync(400);
    expect(useLaserStore.getState().controllerOperation).toBe(secondOwner);
    expect(useLaserStore.getState().controllerQualification.kind).toBe('failed');
    expect(f.writes.filter((line) => line === 'M5\n')).toHaveLength(1);
    expect(f.writes.filter((line) => line === 'M9\n')).toHaveLength(1);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(3);
    expect(f.writes).not.toContain('$$\n');
  });

  it('does not let a delayed hosted release from accepted Abort cancel a fresh Frame', async () => {
    const f = await connect('Idle', true);
    f.controls.reset = 'immediate-boot';
    f.controls.holdHostedRelease = true;
    let completed = false;
    const stop = useLaserStore
      .getState()
      .stopJob()
      .then(() => {
        completed = true;
      });
    await vi.advanceTimersByTimeAsync(300);
    // Information refresh may still be waiting while the hosted release is
    // held. Frame is permitted after the actual reset cleanup and ACK fence
    // settle, so this exercises the later Stop continuation against real work.
    expect(useLaserStore.getState()).toMatchObject({
      controllerOperation: null,
      pendingUntrackedAcks: 0,
      pendingTransportWrites: 0,
    });
    expect(completed).toBe(false);
    f.controls.reset = 'accepted';
    f.controls.cleanupAck = false;
    f.writes.length = 0;
    await useLaserStore
      .getState()
      .frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, framedRunCandidate());
    const frame = useLaserStore.getState().motionOperation;
    expect(frame?.kind).toBe('frame');
    f.controls.holdHostedRelease = false;
    f.releaseHosted();
    await stop;
    expect(useLaserStore.getState().motionOperation).toBe(frame);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    f.writes.length = 0;
    await useLaserStore.getState().stopJob();
    expect(useLaserStore.getState().motionOperation).toBeNull();
    expect(f.writes.filter((line) => line === '\x18')).toHaveLength(1);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    f.completeReset();
    await flush();
  });

  it('keeps the boot window when initial qualification was awaiting fresh Idle', async () => {
    const f = await connect('Run');
    expect(useLaserStore.getState()).toMatchObject({
      controllerOperation: { kind: 'connection-handshake' },
      pendingUntrackedAcks: 0,
      pendingTransportWrites: 0,
    });
    await useLaserStore.getState().stopJob();
    const resetOwner = useLaserStore.getState().controllerOperation;
    await flush();
    expect(useLaserStore.getState().controllerOperation).toBe(resetOwner);
    expectNoCleanup(f);
    await vi.advanceTimersByTimeAsync(499);
    expectNoCleanup(f);
    expect(useLaserStore.getState().controllerOperation).toBe(resetOwner);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.writes.filter((line) => line === 'M5\n')).toHaveLength(1);
    expect(f.writes.filter((line) => line === 'M9\n')).toHaveLength(1);
    expect(f.writes.filter((line) => line === '\x18')).toHaveLength(1);
    f.controls.state = 'Idle';
    f.status();
    await vi.advanceTimersByTimeAsync(250);
    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
  });

  it.each(['awaiting', 'just-observed'])(
    'keeps its reset owner when an old probe boot is %s',
    async (boundary) => {
      const f = await connect();
      expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
      f.controls.rejectProbe = true;
      const probe = useLaserStore.getState().probe(Z_REQUEST);
      await flush();
      expect(useLaserStore.getState()).toMatchObject({
        controllerOperation: { kind: 'probe', phase: 'recovering' },
        pendingUntrackedAcks: 0,
        pendingTransportWrites: 0,
      });
      expect(f.writes.filter((line) => line === '\x18')).toHaveLength(1);
      f.writes.length = 0;
      if (boundary === 'just-observed') f.emit('Grbl 1.1f');
      await useLaserStore.getState().stopJob();
      const resetOwner = useLaserStore.getState().controllerOperation;
      await flush();
      await expect(probe).resolves.toMatchObject({ kind: 'rejected', errorCode: 20 });
      expect(useLaserStore.getState().controllerOperation).toBe(resetOwner);
      expect(useLaserStore.getState().probeBusy).toBe(false);
      expectNoCleanup(f);
      await vi.advanceTimersByTimeAsync(499);
      expectNoCleanup(f);
      expect(useLaserStore.getState().controllerOperation).toBe(resetOwner);
      await vi.advanceTimersByTimeAsync(1);
      expect(f.writes.filter((line) => line === 'M5\n')).toHaveLength(1);
      expect(f.writes.filter((line) => line === 'M9\n')).toHaveLength(1);
      expect(f.writes.filter((line) => line === '\x18')).toHaveLength(1);
      expect(useLaserStore.getState().controllerOperation).toBeNull();
      expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
    },
  );

  it.each(['rejected', 'hung'])(
    'freezes a partial Frame before %s reset transport and retains its old reply',
    async (reset) => {
      const f = await connect();
      f.controls.cleanupAck = false;
      await useLaserStore
        .getState()
        .frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, framedRunCandidate());
      expect(f.writes).toEqual(['M5\n']);
      expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
      expect(useLaserStore.getState().motionOperation).toMatchObject({
        kind: 'frame',
        acknowledgedPrefixLinesRemaining: 2,
      });
      f.controls.reset = reset;
      f.writes.length = 0;
      const stop = useLaserStore
        .getState()
        .stopJob()
        .catch((error: unknown) => error);
      expect(useLaserStore.getState().motionOperation).toBeNull();
      expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
      f.emit('ok');
      f.status();
      await flush();
      expectNoCleanup(f);
      expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
      expect(f.writes.some((line) => line.startsWith('$J=') || line.startsWith('G1'))).toBe(false);
      await vi.advanceTimersByTimeAsync(600);
      await expect(stop).resolves.toBeInstanceOf(Error);
      f.completeReset();
      await flush();
      expect(f.writes.filter((line) => line === 'M5\n')).toHaveLength(1);
      expect(f.writes.filter((line) => line === 'M9\n')).toHaveLength(1);
      expect(useLaserStore.getState().pendingUntrackedAcks).toBe(2);
      expect(f.writes).not.toContain('$$\n');
      expect(f.writes.some((line) => line.startsWith('$J=') || line.startsWith('G1'))).toBe(false);
      expect(useLaserStore.getState()).toMatchObject({
        frameVerification: null,
        framedRun: null,
        controllerOperation: { kind: 'recovery', phase: 'reset' },
        controllerQualification: { kind: 'failed' },
      });
    },
  );
});
