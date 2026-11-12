// Code quality audit C2, D3 mutant X01: a Smoothieware Abort freezes the
// stream (marks it errored) before its first wire await. The Ctrl-X write can
// stay pending on a busy port while acknowledgements for lines already sent
// keep arriving; an active stream would refill a job line behind the reset.
// The halted Smoothieware then answers it with `!!`, and the stream raises a
// misleading "controller rejected a command" notice while Abort stalls.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSmoothieSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { disconnectOnTestClock } from './laser-disconnect-testing';
import { useLaserStore } from './laser-store';
import { startTestLaserJob } from './laser-test-start-helpers';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await disconnectOnTestClock();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    connection: { kind: 'disconnected' },
    statusReport: null,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
    lastWriteError: null,
    safetyNotice: null,
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function pump(ms = 10): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

const JOB_LINE = /^G1 X\d+ Y1 F600 S200/;

/** The simulator's adapter, with a Ctrl-X write that reaches the controller
 * but whose promise stays pending until `release` is called. */
function holdResetWrite(base: PlatformAdapter): {
  readonly adapter: PlatformAdapter;
  arm(): void;
  release(): void;
} {
  let armed = false;
  let release: (() => void) | null = null;
  const adapter = {
    ...base,
    serial: {
      ...base.serial,
      requestPort: async () => {
        const port = await base.serial.requestPort();
        if (port === null) return null;
        return {
          open: async (request: Parameters<typeof port.open>[0]) => {
            const connection: SerialConnection = await port.open(request);
            return {
              ...connection,
              write: async (data: string) => {
                if (!armed || data !== '\x18') return connection.write(data);
                await connection.write(data);
                await new Promise<void>((resolve) => {
                  release = resolve;
                });
              },
            };
          },
        };
      },
    },
  } as PlatformAdapter;
  return {
    adapter,
    arm: () => {
      armed = true;
    },
    release: () => release?.(),
  };
}

describe('Smoothieware Abort while the Ctrl-X write is still pending (C2 D3, X01)', () => {
  it('keeps the stream errored and sends no job line behind the reset', async () => {
    const sim = createSmoothieSimulator({ motionMs: 50 });
    const held = holdResetWrite(sim.adapter);
    useStore.getState().updateDeviceProfile({ controllerKind: 'smoothieware' });
    await useLaserStore.getState().connect(held.adapter, { controllerKind: 'smoothieware' });
    await pump(1_200);
    const program = Array.from({ length: 300 }, (_, i) => `G1 X${i % 50} Y1 F600 S200`);
    await startTestLaserJob(program.join('\n'), { streamingMode: 'ping-pong' });
    await pump(200);
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');

    held.arm();
    const before = sim.outbound().length;
    let outcome: 'pending' | 'resolved' | 'rejected' = 'pending';
    void useLaserStore
      .getState()
      .stopJob()
      .then(
        () => (outcome = 'resolved'),
        () => (outcome = 'rejected'),
      );
    // Ctrl-X reached the controller; its write promise has not settled, and
    // acknowledgements for lines already in flight arrive meanwhile.
    await pump(1_000);
    expect(sim.outbound().slice(before)).toContain('\x18');
    expect(useLaserStore.getState().streamer?.status).toBe('errored');
    expect(
      sim
        .outbound()
        .slice(before)
        .filter((data) => JOB_LINE.test(data)),
    ).toEqual([]);

    held.release();
    await pump(3_000);
    expect(outcome).toBe('resolved');
    expect(
      sim
        .outbound()
        .slice(before)
        .filter((data) => JOB_LINE.test(data)),
    ).toEqual([]);
    expect(useLaserStore.getState().safetyNotice).toBeNull();
  });
});
