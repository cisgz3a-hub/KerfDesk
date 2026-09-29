import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { findMachinePhase } from '../laser/device-setup/find-machine-phase';
import { useLaserStore } from './laser-store';
import { disconnectOnTestClock } from './laser-disconnect-testing';

function silentConnection(): SerialConnection {
  return {
    write: async () => undefined,
    onLine: () => () => undefined,
    onClose: () => () => undefined,
    close: async () => undefined,
  };
}

// A GRBL board that answers nothing while `state` is null (still starting),
// then answers every `?` with that state. Lines it prints by itself are emitted
// by the test.
function startingGrbl(machine: { state: string | null }) {
  const handlers = new Set<(line: string) => void>();
  const emit = (line: string): void => {
    for (const handler of [...handlers]) handler(line);
  };
  const connection: SerialConnection = {
    write: async (data) => {
      if (machine.state === null) return;
      if (data === '?') {
        setTimeout(() => emit(`<${machine.state}|MPos:0.000,0.000,0.000|FS:0,0>`), 5);
      } else if (data === '$$\n') {
        setTimeout(() => {
          for (const line of ['$22=0', '$30=1000', '$32=1', 'ok']) emit(line);
        }, 5);
      } else if (data.endsWith('\n')) {
        setTimeout(() => emit('ok'), 5);
      }
    },
    onLine: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
  };
  return { connection, emit };
}

function logMentionsBaud(): boolean {
  return useLaserStore.getState().log.some((line) => line.includes('Check baud rate'));
}

// The state Find my machine shows for the live connection (ADR-420).
function findMachineShows(): string {
  const laser = useLaserStore.getState();
  return findMachinePhase(
    {
      supportsSerial: true,
      driver: { capabilities: { transport: 'serial' } },
      guide: { label: 'GRBL v1.1', writeExplanation: '' },
      baudRate: 115200,
      laser: {
        connection: laser.connection,
        qualification: laser.controllerQualification,
        statusReport: laser.statusReport,
        detectedControllerKind: laser.detectedControllerKind,
        serialPortInfo: laser.serialPortInfo ?? null,
        connectedBaudRate: laser.connectedBaudRate ?? null,
      },
      scan: { status: { kind: 'idle' } },
    },
    false,
  ).kind;
}

// A Marlin board that does not reboot on open (native USB): no `start`
// banner, but every M114 gets a position line and `ok`.
function bannerlessMarlin(): SerialConnection {
  const handlers = new Set<(line: string) => void>();
  return {
    write: async (data) => {
      if (data !== 'M114\n') return;
      setTimeout(() => {
        for (const handler of handlers) handler('X:0.00 Y:0.00 Z:0.00 E:0.00 Count X:0 Y:0 Z:0');
        for (const handler of handlers) handler('ok');
      }, 0);
    },
    onLine: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
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

afterEach(async () => {
  // Real timers first: a disconnect waits on its own timeouts.
  vi.useRealTimers();
  await disconnectOnTestClock();
});

describe('connection diagnostics', () => {
  // This test used to expect the baud-rate advice after 2 s. A board that
  // resets on open prints its banner only after its whole start-up
  // (https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/main.c#L102),
  // so a slow one was blamed on a baud rate that was right, and Find my
  // machine offered other speeds (controller audit T-4, ADR-375). The advice
  // now waits for 10 s of silence, as LaserGRBL's connect timeout does
  // (https://github.com/arkypita/LaserGRBL/blob/1f9337b3af27133f8b1696e41cc110f2af74d04f/LaserGRBL/Core/GrblCore.cs#L2029).
  it('reports the configured baud only after 10 s of silence', async () => {
    vi.useFakeTimers();
    await useLaserStore
      .getState()
      .connect(adapterFor(silentConnection()), { controllerKind: 'grbl-v1.1', baudRate: 57600 });

    await vi.advanceTimersByTimeAsync(2001);
    expect(useLaserStore.getState().log).toContain(
      '[lf2] No controller response within 2 s. Still listening: a controller can take several seconds to start after the port opens.',
    );
    expect(logMentionsBaud()).toBe(false);
    expect(useLaserStore.getState().controllerQualification).toMatchObject({
      kind: 'qualifying',
      phase: 'controller-response',
    });
    expect(findMachineShows()).toBe('reading');

    await vi.advanceTimersByTimeAsync(8000);
    expect(useLaserStore.getState().log).toContain(
      '[lf2] No controller response within 10 s. Check baud rate (57600) and that the device is GRBL v1.1.',
    );
    expect(useLaserStore.getState().controllerQualification.kind).toBe('failed');
    expect(findMachineShows()).toBe('silent');
  });

  it('qualifies a board whose banner comes after 2 s without blaming the baud rate', async () => {
    vi.useFakeTimers();
    const machine: { state: string | null } = { state: null };
    const board = startingGrbl(machine);
    await useLaserStore
      .getState()
      .connect(adapterFor(board.connection), { controllerKind: 'grbl-v1.1', baudRate: 115200 });

    await vi.advanceTimersByTimeAsync(2_300);
    expect(findMachineShows()).toBe('reading');
    machine.state = 'Idle';
    board.emit('');
    board.emit("Grbl 1.1h ['$' for help]");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(logMentionsBaud()).toBe(false);
    expect(useLaserStore.getState().controllerQualification).toMatchObject({ kind: 'qualified' });
    expect(findMachineShows()).toBe('found');
  });

  it('names the baud rate when the controller sends only undecodable bytes', async () => {
    vi.useFakeTimers();
    const board = startingGrbl({ state: null });
    await useLaserStore
      .getState()
      .connect(adapterFor(board.connection), { controllerKind: 'grbl-v1.1', baudRate: 9600 });

    await vi.advanceTimersByTimeAsync(3_000);
    board.emit('\uFFFD\uFFFDx\uFFFD');
    board.emit('~\uFFFD');
    await vi.advanceTimersByTimeAsync(7_100);

    expect(useLaserStore.getState().log).toContain(
      '[lf2] Only undecodable data from the controller within 10 s. Check baud rate (9600) and that the device is GRBL v1.1.',
    );
    expect(useLaserStore.getState().controllerQualification.kind).toBe('failed');
  });

  it('does not blame the baud rate when readable lines come without a status report', async () => {
    vi.useFakeTimers();
    const board = startingGrbl({ state: null });
    await useLaserStore
      .getState()
      .connect(adapterFor(board.connection), { controllerKind: 'grbl-v1.1', baudRate: 115200 });

    await vi.advanceTimersByTimeAsync(3_000);
    board.emit('echo:Unknown command: "?"');
    await vi.advanceTimersByTimeAsync(7_100);

    expect(useLaserStore.getState().log).toContain(
      '[lf2] The controller sent data but no status report within 10 s. Check that the device is GRBL v1.1.',
    );
    expect(logMentionsBaud()).toBe(false);
    expect(useLaserStore.getState().controllerQualification.kind).toBe('failed');
  });

  it('keeps waiting for the operator when the first answer after 2 s is an Alarm', async () => {
    vi.useFakeTimers();
    const machine: { state: string | null } = { state: null };
    const board = startingGrbl(machine);
    await useLaserStore
      .getState()
      .connect(adapterFor(board.connection), { controllerKind: 'grbl-v1.1', baudRate: 115200 });

    await vi.advanceTimersByTimeAsync(2_500);
    machine.state = 'Alarm';
    await vi.advanceTimersByTimeAsync(15_000);
    expect(useLaserStore.getState().statusReport?.state).toBe('Alarm');
    expect(logMentionsBaud()).toBe(false);
    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualifying');

    machine.state = 'Idle'; // unlocked at the machine
    await vi.advanceTimersByTimeAsync(2_000);
    expect(useLaserStore.getState().controllerQualification).toMatchObject({ kind: 'qualified' });
  });

  // Controller audit connect-5: Marlin has no realtime status query, so the
  // handshake sends nothing and its silence proves nothing. The first M114
  // poll decides; only a board that never answers it is reported.
  it('waits for the first status poll before calling a silent Marlin unresponsive', async () => {
    vi.useFakeTimers();
    await useLaserStore
      .getState()
      .connect(adapterFor(silentConnection()), { controllerKind: 'marlin', baudRate: 57600 });

    await vi.advanceTimersByTimeAsync(2001);
    expect(useLaserStore.getState().controllerQualification).toMatchObject({
      kind: 'qualifying',
      phase: 'controller-response',
    });
    expect(
      useLaserStore.getState().log.some((line) => line.includes('No controller response')),
    ).toBe(false);

    await vi.advanceTimersByTimeAsync(8000);
    expect(useLaserStore.getState().log).toContain(
      '[lf2] No controller response within 8 s. Check baud rate (57600) and that the device is Marlin.',
    );
    expect(useLaserStore.getState().controllerQualification.kind).toBe('failed');
  });

  it('qualifies a Marlin board that answers M114 without a startup banner', async () => {
    vi.useFakeTimers();
    await useLaserStore
      .getState()
      .connect(adapterFor(bannerlessMarlin()), { controllerKind: 'marlin', baudRate: 250000 });

    await vi.advanceTimersByTimeAsync(10_000);

    const laser = useLaserStore.getState();
    expect(laser.log.some((line) => line.includes('No controller response'))).toBe(false);
    expect(laser.controllerQualification).toMatchObject({
      kind: 'qualified',
      settings: 'not-required',
    });
  });
});
