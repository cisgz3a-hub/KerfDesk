import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';
import {
  LASER_START_OVERRIDE_RESET,
  laserStartNeedsOverrideReset,
  laserStartOverrideResetLogLine,
} from './laser-start-override-reset';
import { startTestLaserJob } from './laser-test-start-helpers';

describe('laserStartNeedsOverrideReset', () => {
  const baseline = { feed: 100, rapid: 100, spindle: 100 };

  it('resets a laser job whose controller still holds a leftover override', () => {
    expect(laserStartNeedsOverrideReset('laser', true, { ...baseline, feed: 60 })).toBe(true);
    expect(laserStartNeedsOverrideReset('laser', true, { ...baseline, spindle: 80 })).toBe(true);
    expect(laserStartNeedsOverrideReset('laser', true, { ...baseline, rapid: 50 })).toBe(true);
  });

  it('resets when no Ov: report has proved the overrides are at 100%', () => {
    expect(laserStartNeedsOverrideReset('laser', true, null)).toBe(true);
  });

  it('sends nothing when the controller already reports 100%', () => {
    expect(laserStartNeedsOverrideReset('laser', true, baseline)).toBe(false);
  });

  it('leaves CNC to its own override policy and never writes to firmware without overrides', () => {
    expect(laserStartNeedsOverrideReset('cnc', true, { ...baseline, feed: 60 })).toBe(false);
    expect(laserStartNeedsOverrideReset('laser', false, { ...baseline, feed: 60 })).toBe(false);
  });

  it('names what it reset in the log', () => {
    expect(laserStartOverrideResetLogLine({ feed: 60, rapid: 100, spindle: 80 })).toContain(
      'were feed 60%, rapid 100%, power 80%',
    );
  });
});

type FakeConnection = SerialConnection & { readonly emitLine: (line: string) => void };

function makeConnection(write: (data: string) => Promise<void>): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const emit = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  return {
    write: async (data) => {
      await write(data);
      if (
        data === '$I\n' &&
        useLaserStore.getState().controllerOperation?.kind === 'connection-handshake'
      ) {
        emit('[VER:1.1h.20190830:test]');
        emit('[OPT:VM,15,128]');
        emit('ok');
      }
    },
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    emitLine: emit,
  };
}

function makeAdapter(connection: SerialConnection): PlatformAdapter {
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

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

/** Connect, then have the controller report `status` — the Idle frame a
 * grblHAL controller sends after the soft reset that ended the previous job. */
async function connectReporting(connection: FakeConnection, status: string): Promise<void> {
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1f');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
  connection.emitLine('ok');
  connection.emitLine(status);
  await flush();
}

describe('laser Start resets leftover overrides (ADR-355)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await useLaserStore.getState().disconnect();
    vi.restoreAllMocks();
  });

  it('puts the reset in front of the first program window when an override survived', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectReporting(connection, '<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:60,100,80>');
    expect(useLaserStore.getState().ovCache).toEqual({ feed: 60, rapid: 100, spindle: 80 });
    writes.length = 0;

    await startTestLaserJob('G21\nG90\nM3 S0\nM5\n', { streamingMode: 'ping-pong' });

    expect(writes[0]).toBe(`${LASER_START_OVERRIDE_RESET}G21\n`);
    // Realtime bytes never enter GRBL's receive buffer, so the streamer must
    // not charge them against it.
    expect(useLaserStore.getState().streamer?.inFlight).toEqual([{ line: 'G21\n', bytes: 4 }]);
    expect(useLaserStore.getState().log.join('\n')).toContain(
      'were feed 60%, rapid 100%, power 80%',
    );
  });

  it('writes the program alone when the controller already reports 100%', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectReporting(connection, '<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>');
    writes.length = 0;

    await startTestLaserJob('G21\nG90\nM3 S0\nM5\n', { streamingMode: 'ping-pong' });

    expect(writes[0]).toBe('G21\n');
  });

  it('sends nothing, reset included, when the Start is refused', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectReporting(connection, '<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:60,100,80>');
    writes.length = 0;

    await expect(startTestLaserJob('G21\nG1 X1234567890\n', { rxBufferBytes: 10 })).rejects.toThrow(
      /10-byte RX buffer/i,
    );

    expect(writes).toEqual([]);
  });
});
