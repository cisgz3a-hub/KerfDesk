import { afterEach, describe, expect, it, vi } from 'vitest';
import { grblDriver } from '../../core/controllers';
import {
  RT_FEED_OV_MINUS_1,
  RT_FEED_OV_MINUS_10,
  RT_FEED_OV_PLUS_1,
  RT_FEED_OV_PLUS_10,
  RT_FEED_OV_RESET,
  RT_RAPID_OV_FULL,
  RT_RAPID_OV_HALF,
  RT_RAPID_OV_QUARTER,
  RT_SPINDLE_OV_MINUS_1,
  RT_SPINDLE_OV_MINUS_10,
  RT_SPINDLE_OV_PLUS_1,
  RT_SPINDLE_OV_PLUS_10,
  RT_SPINDLE_OV_RESET,
} from '../../core/controllers/grbl';
import { createProject } from '../../core/scene';
import { useExperimentalLaserFeatures } from './experimental-laser-features';
import { LASER_START_OVERRIDE_RESET } from './laser-start-override-reset';
import { createSafeWrite } from './laser-safe-write';
import { useLaserStore } from './laser-store';
import {
  connectWith,
  makeConnection,
  type FakeConnection,
} from './laser-store-console.test-support';
import { startTestLaserJob } from './laser-test-start-helpers';
import { useStore } from './store';

const BASELINE = { feed: 100, rapid: 100, spindle: 100 };
const BASELINE_REPORT = '<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>';
const SPARSE_REPORT = '<Idle|MPos:0.000,0.000,0.000|FS:0,0>';
const PROGRAM = 'G21\nM4 S0\nG1 X10 F1500 S1000\nM5\n';

async function baselineConnection(write: (data: string) => Promise<void>): Promise<FakeConnection> {
  const connection = makeConnection(async (data) => {
    await write(data);
    if (data === `${grblDriver.commands.settleDwell}\n`) connection.emitLine('ok');
  });
  await connectWith(connection);
  connection.emitLine(BASELINE_REPORT);
  expect(useLaserStore.getState().ovCache).toEqual(BASELINE);
  return connection;
}

async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 128 && !predicate(); index += 1) await Promise.resolve();
  expect(predicate()).toBe(true);
}

function enableFire(): void {
  useStore.setState({ project: createProject() });
  useStore.getState().updateDeviceProfile({
    capabilities: ['low-power-fire'],
    fireControl: { enabled: true, maxPowerPercent: 2 },
    maxPowerS: 1000,
    framingFeedMmPerMin: 1000,
  });
  useExperimentalLaserFeatures.getState().setFeature('lowPowerFire', true);
}

afterEach(async () => {
  useLaserStore.setState({ fireActive: false });
  await useLaserStore.getState().disconnect();
  useExperimentalLaserFeatures.getState().resetFeatures();
  useStore.setState({ project: createProject() });
  vi.restoreAllMocks();
});

describe('admitted realtime overrides retire the last observed Ov percentages', () => {
  it.each([
    ['feed reset', RT_FEED_OV_RESET],
    ['feed +10', RT_FEED_OV_PLUS_10],
    ['feed -10', RT_FEED_OV_MINUS_10],
    ['feed +1', RT_FEED_OV_PLUS_1],
    ['feed -1', RT_FEED_OV_MINUS_1],
    ['rapid 100', RT_RAPID_OV_FULL],
    ['rapid 50', RT_RAPID_OV_HALF],
    ['rapid 25', RT_RAPID_OV_QUARTER],
    ['power reset', RT_SPINDLE_OV_RESET],
    ['power +10', RT_SPINDLE_OV_PLUS_10],
    ['power -10', RT_SPINDLE_OV_MINUS_10],
    ['power +1', RT_SPINDLE_OV_PLUS_1],
    ['power -1', RT_SPINDLE_OV_MINUS_1],
  ] as const)('retires the cache before %s reaches the adapter', async (_label, byte) => {
    let cacheAtWrite: unknown;
    const connection = await baselineConnection(async (data) => {
      if (data === byte) cacheAtWrite = useLaserStore.getState().ovCache;
    });

    await useLaserStore.getState().sendRealtimeOverride(byte);

    expect(cacheAtWrite).toBeNull();
    connection.emitLine(SPARSE_REPORT);
    expect(useLaserStore.getState().ovCache).toBeNull();
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:90,50,80>');
    expect(useLaserStore.getState().ovCache).toEqual({ feed: 90, rapid: 50, spindle: 80 });
    connection.emitLine(BASELINE_REPORT);
    expect(useLaserStore.getState().ovCache).toEqual(BASELINE);
  });

  it('restores full commanded power for a new job after reduced power with no subsequent Ov field', async () => {
    const writes: string[] = [];
    let controllerPowerOverride = 100;
    const connection = await baselineConnection(async (data) => {
      writes.push(data);
      // Independent controller model: one applied coarse power decrement,
      // then only the spindle-reset byte can bring this controller to 100%.
      for (const byte of data) {
        if (byte === RT_SPINDLE_OV_MINUS_10) controllerPowerOverride -= 10;
        if (byte === RT_SPINDLE_OV_RESET) controllerPowerOverride = 100;
      }
    });
    await useLaserStore.getState().sendRealtimeOverride(RT_SPINDLE_OV_MINUS_10);
    expect(controllerPowerOverride).toBe(90);
    connection.emitLine(SPARSE_REPORT);
    writes.length = 0;

    await startTestLaserJob(PROGRAM, { streamingMode: 'ping-pong' });

    expect(writes.slice(0, 3)).toEqual([
      `${grblDriver.commands.settleDwell}\n`,
      LASER_START_OVERRIDE_RESET,
      'G21\n',
    ]);
    expect(controllerPowerOverride).toBe(100);
    // This proves the nominal override multiplier, not measured laser output.
    expect((1000 * controllerPowerOverride) / 100).toBe(1000);
  });

  it('establishes the new-run baseline even after a fresh 100% Ov report', async () => {
    const writes: string[] = [];
    const connection = await baselineConnection(async (data) => {
      writes.push(data);
    });
    await useLaserStore.getState().sendRealtimeOverride(RT_SPINDLE_OV_MINUS_10);
    connection.emitLine(BASELINE_REPORT);
    writes.length = 0;

    await startTestLaserJob(PROGRAM, { streamingMode: 'ping-pong' });

    expect(writes.slice(0, 3)).toEqual([
      `${grblDriver.commands.settleDwell}\n`,
      LASER_START_OVERRIDE_RESET,
      'G21\n',
    ]);
  });

  it('keeps a fresh Ov that arrived before its transport promise completed', async () => {
    const connection = await baselineConnection(async (data) => {
      if (data === RT_SPINDLE_OV_MINUS_10) {
        connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,90>');
      }
    });

    await useLaserStore.getState().sendRealtimeOverride(RT_SPINDLE_OV_MINUS_10);

    expect(useLaserStore.getState().ovCache).toEqual({ feed: 100, rapid: 100, spindle: 90 });
  });

  it('leaves percentages unknown after a rejected write that might have reached the controller', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await baselineConnection(async (data) => {
      if (data === RT_SPINDLE_OV_MINUS_10) throw new Error('Ambiguous write failure');
    });

    await expect(
      useLaserStore.getState().sendRealtimeOverride(RT_SPINDLE_OV_MINUS_10),
    ).rejects.toThrow('Ambiguous write failure');

    expect(useLaserStore.getState().ovCache).toBeNull();
  });

  it('does not retire the cache when capability admission prevents the write', async () => {
    const writes: string[] = [];
    await baselineConnection(async (data) => {
      writes.push(data);
    });
    useLaserStore.setState((state) => ({
      capabilities: { ...state.capabilities, overrides: false },
    }));
    writes.length = 0;

    await useLaserStore.getState().sendRealtimeOverride(RT_SPINDLE_OV_MINUS_10);

    expect(writes).toEqual([]);
    expect(useLaserStore.getState().ovCache).toEqual(BASELINE);
  });

  it('does not retire the cache for ordinary ASCII or another realtime command', async () => {
    await baselineConnection(async () => undefined);
    const write = createSafeWrite(useLaserStore.setState, useLaserStore.getState, {
      connection: makeConnection(async () => undefined),
      driver: grblDriver,
      nextTranscriptId: 1,
    });

    await write('?');
    await write('M5\n');

    expect(useLaserStore.getState().ovCache).toEqual(BASELINE);
  });

  it('does not retire the cache for an override embedded in a refused queued line', async () => {
    await baselineConnection(async () => undefined);
    const write = createSafeWrite(useLaserStore.setState, useLaserStore.getState, {
      connection: makeConnection(async () => undefined),
      driver: grblDriver,
      nextTranscriptId: 1,
    });

    await expect(write(`${RT_SPINDLE_OV_MINUS_10}\n`)).rejects.toThrow(/realtime command/);

    expect(useLaserStore.getState().ovCache).toEqual(BASELINE);
  });

  it('cannot let a pending old connection completion erase a replacement session Ov', async () => {
    let releaseOld: () => void = () => undefined;
    await baselineConnection(async (data) => {
      if (data === RT_SPINDLE_OV_MINUS_10) {
        await new Promise<void>((resolve) => {
          releaseOld = resolve;
        });
      }
    });
    const oldWrite = useLaserStore.getState().sendRealtimeOverride(RT_SPINDLE_OV_MINUS_10);
    const oldFailure = expect(oldWrite).rejects.toThrow(/serial session changed/i);
    const cacheAtAdmission = useLaserStore.getState().ovCache;

    await useLaserStore.getState().disconnect();
    await baselineConnection(async () => undefined);
    const replacementEpoch = useLaserStore.getState().controllerSessionEpoch;
    releaseOld();
    await oldFailure;

    expect(cacheAtAdmission).toBeNull();
    expect(useLaserStore.getState().controllerSessionEpoch).toBe(replacementEpoch);
    expect(useLaserStore.getState().ovCache).toEqual(BASELINE);
  });
});

// Independent stock-GRBL accessory flag oracle. The serial interrupt sets
// flags, not immediately applied percentages. protocol.c prints a requested
// status first, then applies RESET before COARSE_PLUS/MINUS in that same batch:
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L233-L237
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L407-L426
// A queued line passes the realtime checkpoint before its execution and ok.
async function pendingOverrideController(increment: boolean): Promise<{
  readonly connection: FakeConnection;
  readonly writes: string[];
  readonly powerOverride: () => number;
}> {
  let pendingReset = false;
  let pendingPlus = false;
  let pendingMinus = false;
  let powerOverride = 100;
  const writes: string[] = [];
  const applyFlags = (): void => {
    if (pendingReset) powerOverride = 100;
    if (pendingPlus) powerOverride += 10;
    if (pendingMinus) powerOverride -= 10;
    powerOverride = Math.min(200, Math.max(10, powerOverride));
    pendingReset = pendingPlus = pendingMinus = false;
  };
  const connection = await baselineConnection(async (data) => {
    writes.push(data);
    for (const byte of data) {
      if (byte === RT_SPINDLE_OV_RESET) pendingReset = true;
      if (byte === RT_SPINDLE_OV_PLUS_10) pendingPlus = true;
      if (byte === RT_SPINDLE_OV_MINUS_10) pendingMinus = true;
    }
    if (data.includes('\n')) applyFlags();
  });
  await useLaserStore
    .getState()
    .sendRealtimeOverride(increment ? RT_SPINDLE_OV_PLUS_10 : RT_SPINDLE_OV_MINUS_10);
  return { connection, writes, powerOverride: () => powerOverride };
}

describe('GRBL status-before-override and coalesced flags cannot change a new baseline', () => {
  it.each([false, true])(
    'starts at full nominal power when a pre-application baseline Ov was restored: %s',
    async (preApplicationReport) => {
      const controller = await pendingOverrideController(false);
      // With true, the status-print phase exposes the old 100% before the
      // pending decrement phase. With false, the upcoming reset and decrement
      // would coalesce, and GRBL applies reset first, then the decrement.
      controller.connection.emitLine(preApplicationReport ? BASELINE_REPORT : SPARSE_REPORT);
      controller.writes.length = 0;

      await startTestLaserJob(PROGRAM, { streamingMode: 'ping-pong' });

      expect(controller.powerOverride()).toBe(100);
      expect(controller.writes.slice(0, 3)).toEqual([
        `${grblDriver.commands.settleDwell}\n`,
        LASER_START_OVERRIDE_RESET,
        'G21\n',
      ]);
    },
  );

  it.each([false, true])(
    'keeps the Fire command ceiling when a pre-application baseline Ov was restored: %s',
    async (preApplicationReport) => {
      enableFire();
      const controller = await pendingOverrideController(true);
      controller.connection.emitLine(preApplicationReport ? BASELINE_REPORT : SPARSE_REPORT);
      controller.writes.length = 0;

      await useLaserStore.getState().setFireActive(true);

      expect(controller.powerOverride()).toBe(100);
      expect(controller.writes).toEqual([
        `${grblDriver.commands.settleDwell}\n`,
        RT_SPINDLE_OV_RESET,
        'G1 F1000 M3 S20\n',
      ]);
      expect((20 * controller.powerOverride()) / 100).toBe(20);
    },
  );
});

describe('override baseline transactions preserve API and session ownership', () => {
  it('locks user overrides during Start arming and admits them after accepted Start and while paused', async () => {
    const writes: string[] = [];
    let releaseFence: (() => void) | undefined;
    await baselineConnection(async (data) => {
      writes.push(data);
      if (data === `${grblDriver.commands.settleDwell}\n`) {
        await new Promise<void>((resolve) => {
          releaseFence = resolve;
        });
      }
    });
    writes.length = 0;
    const starting = startTestLaserJob(PROGRAM, { streamingMode: 'ping-pong' });
    await flushUntil(() => releaseFence !== undefined);

    await expect(
      useLaserStore.getState().sendRealtimeOverride(RT_SPINDLE_OV_MINUS_10),
    ).rejects.toThrow(/Wait for Start/);
    expect(writes).toEqual([`${grblDriver.commands.settleDwell}\n`]);
    releaseFence?.();
    await starting;
    await useLaserStore.getState().sendRealtimeOverride(RT_SPINDLE_OV_MINUS_10);
    expect(writes.at(-1)).toBe(RT_SPINDLE_OV_MINUS_10);
    useLaserStore.setState((state) => ({
      streamer: state.streamer === null ? null : { ...state.streamer, status: 'paused' },
    }));
    await useLaserStore.getState().sendRealtimeOverride(RT_FEED_OV_MINUS_10);
    expect(writes.at(-1)).toBe(RT_FEED_OV_MINUS_10);
  });

  it('locks user overrides during Fire and sends no reset or beam-on if release wins its fence', async () => {
    enableFire();
    const writes: string[] = [];
    let releaseFence: (() => void) | undefined;
    await baselineConnection(async (data) => {
      writes.push(data);
      if (data === `${grblDriver.commands.settleDwell}\n`) {
        await new Promise<void>((resolve) => {
          releaseFence = resolve;
        });
      }
    });
    writes.length = 0;
    const starting = useLaserStore.getState().setFireActive(true);
    await flushUntil(() => releaseFence !== undefined);

    await expect(
      useLaserStore.getState().sendRealtimeOverride(RT_SPINDLE_OV_PLUS_10),
    ).rejects.toThrow(/Release momentary Fire/);
    await useLaserStore.getState().setFireActive(false);
    releaseFence?.();
    await starting;

    expect(writes).toEqual([`${grblDriver.commands.settleDwell}\n`, 'M5\n']);
    expect(useLaserStore.getState().fireActive).toBe(false);
  });

  it('sends no old program or reset when a replacement connection wins the Start fence', async () => {
    const oldWrites: string[] = [];
    let releaseFence: (() => void) | undefined;
    await baselineConnection(async (data) => {
      oldWrites.push(data);
      if (data === `${grblDriver.commands.settleDwell}\n`) {
        await new Promise<void>((resolve) => {
          releaseFence = resolve;
        });
      }
    });
    oldWrites.length = 0;
    const starting = startTestLaserJob(PROGRAM, { streamingMode: 'ping-pong' });
    const failedStart = expect(starting).rejects.toThrow(/disconnect|session|controller/i);
    await flushUntil(() => releaseFence !== undefined);
    await useLaserStore.getState().disconnect();
    const replacementWrites: string[] = [];
    await baselineConnection(async (data) => {
      replacementWrites.push(data);
    });
    replacementWrites.length = 0;
    releaseFence?.();
    await failedStart;

    expect(oldWrites).not.toContain(LASER_START_OVERRIDE_RESET);
    expect(oldWrites.join('')).not.toContain('G21');
    expect(replacementWrites).toEqual([]);
    expect(useLaserStore.getState().ovCache).toEqual(BASELINE);
  });

  it('cannot clear a replacement Fire latch when an old reset write settles late', async () => {
    enableFire();
    const oldWrites: string[] = [];
    let releaseReset: (() => void) | undefined;
    await baselineConnection(async (data) => {
      oldWrites.push(data);
      if (data === RT_SPINDLE_OV_RESET) {
        await new Promise<void>((resolve) => {
          releaseReset = resolve;
        });
      }
    });
    const starting = useLaserStore.getState().setFireActive(true);
    const failedFire = expect(starting).rejects.toThrow(/serial session changed/i);
    await flushUntil(() => releaseReset !== undefined);
    await useLaserStore.getState().disconnect();
    await baselineConnection(async () => undefined);
    const replacementEpoch = useLaserStore.getState().controllerSessionEpoch;
    // Represents a newer activation owner on the replacement session. The
    // old promise must neither send beam-on there nor clear its OFF affordance.
    useLaserStore.setState({ fireActive: true });
    releaseReset?.();
    await failedFire;

    expect(oldWrites.join('')).not.toContain('G1 F1000 M3 S20');
    expect(useLaserStore.getState().controllerSessionEpoch).toBe(replacementEpoch);
    expect(useLaserStore.getState().fireActive).toBe(true);
  });
});
