import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';

const FAMILIES = ['marlin', 'smoothieware'] as const;

function board() {
  const lines = new Set<(line: string) => void>();
  const closes = new Set<() => void>();
  const writes: string[] = [];
  const pending: Array<() => void> = [];
  let stalled = true;
  const close = vi.fn(async () => undefined);
  const connection: SerialConnection = {
    write: async (line) => {
      writes.push(line);
      if (stalled) await new Promise<void>((resolve) => pending.push(resolve));
    },
    close,
    onLine: (handler) => {
      lines.add(handler);
      return () => lines.delete(handler);
    },
    onClose: (handler) => {
      closes.add(handler);
      return () => closes.delete(handler);
    },
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
    connection,
    close,
    writes,
    emit: (line: string) => lines.forEach((handler) => handler(line)),
    release: () => {
      stalled = false;
      pending.splice(0).forEach((resolve) => resolve());
    },
    unplug: () => closes.forEach((handler) => handler()),
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

let currentBoard: ReturnType<typeof board> | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  useLaserStore.setState(initialLaserState());
});

afterEach(async () => {
  currentBoard?.release();
  currentBoard?.unplug();
  currentBoard = null;
  await flush();
  useLaserStore.setState(initialLaserState());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('non-GRBL disconnect containment', () => {
  it('freezes Marlin refill while Abort waits for its first stop write', async () => {
    const device = board();
    currentBoard = device;
    await useLaserStore.getState().connect(device.adapter, { controllerKind: 'marlin' });
    useLaserStore.setState({
      streamer: step(
        createStreamer('G1 X1 S100\nG1 X2 S100\nG1 X3 S100', {
          streamingMode: 'ping-pong',
        }),
      ).state,
      controllerOperation: null,
    });

    const stopping = useLaserStore.getState().stopJob();
    await flush();
    device.emit('ok');
    await flush();
    const refill = device.writes.filter((line) => line.includes('G1 X2'));

    device.release();
    await stopping;
    expect(refill).toEqual([]);
    expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
  });

  it.each(FAMILIES)('freezes %s refill before waiting for the first stop write', async (family) => {
    const device = board();
    currentBoard = device;
    await useLaserStore.getState().connect(device.adapter, { controllerKind: family });
    // A job with its first line on the wire and further lines awaiting its ACK.
    const streaming = step(
      createStreamer('G1 X1 S100\nG1 X2 S100\nG1 X3 S100', {
        streamingMode: 'ping-pong',
      }),
    ).state;
    useLaserStore.setState({ streamer: streaming, controllerOperation: null, airAssistOn: true });

    const disconnecting = useLaserStore.getState().disconnect();
    await flush();
    expect(device.writes.length).toBeGreaterThan(0);
    device.emit('ok');
    await flush();
    const refill = device.writes.filter((line) => line.includes('G1 X2'));

    device.release();
    await vi.advanceTimersByTimeAsync(4_000);
    await disconnecting;
    expect(refill).toEqual([]);
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
  });

  it.each(FAMILIES)('finishes %s disconnect even when stop writes never settle', async (family) => {
    const device = board();
    currentBoard = device;
    await useLaserStore.getState().connect(device.adapter, { controllerKind: family });
    useLaserStore.setState({ controllerOperation: null, airAssistOn: true });

    const disconnecting = useLaserStore.getState().disconnect();
    await vi.advanceTimersByTimeAsync(4_000);
    const closedWithinDeadline = device.close.mock.calls.length > 0;
    const stateAtDeadline = useLaserStore.getState();

    // Release the old implementation too, so a failed regression cannot strand teardown.
    device.release();
    await vi.advanceTimersByTimeAsync(2_000);
    await disconnecting;
    expect(closedWithinDeadline).toBe(true);
    expect(stateAtDeadline.connection.kind).toBe('disconnected');
    expect(stateAtDeadline.safetyNotice).not.toBeNull();
    expect(device.writes).toContain('M9\n');
  });
});
