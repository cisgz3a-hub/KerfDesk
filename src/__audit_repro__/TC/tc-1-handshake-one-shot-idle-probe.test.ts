// TC-1 repro: the connect handshake asks for status once, then waits 8 s for a
// fresh Idle that nothing solicits.
//
// Correct behaviour: a GRBL-family controller that is still busy when the port
// opens (buffered motion draining on a board whose USB port does not reset it,
// a Hold, a Door, a Jog) and reaches Idle a few seconds later must still be
// qualified: the host has to keep asking `?` while it waits, because GRBL only
// reports status when asked (grbl/protocol.c protocol_exec_rt_system:
// "if (rt_exec & EXEC_STATUS_REPORT) { report_realtime_status(); ...}" -
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L250-L253),
// and the ordinary status poll is only started after the handshake returns
// (src/ui/state/laser-connection-actions.ts startConnectedControllerHandshake
// .finally).
//
// Current behaviour: waitForHandshakeIdle writes one `?`, the controller answers
// `<Run|...>`, and no further `?` is sent. waitForFreshIdle's 8 s status-silence
// timer expires, the handshake fails with "Timed out waiting for fresh Idle.",
// and nothing re-runs qualification once the machine is Idle.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from '../../ui/state/laser-store';

type Controller = {
  readonly connection: SerialConnection;
  readonly writes: string[];
  readonly queryTimes: number[];
};

function busyThenIdleController(busyForMs: number): Controller {
  const handlers = new Set<(line: string) => void>();
  const writes: string[] = [];
  const queryTimes: number[] = [];
  const start = Date.now();
  const emitLater = (lines: ReadonlyArray<string>): void => {
    setTimeout(() => {
      for (const line of lines) for (const handler of [...handlers]) handler(line);
    }, 5);
  };
  const connection: SerialConnection = {
    write: async (data) => {
      writes.push(data);
      if (data === '?') {
        queryTimes.push(Date.now() - start);
        const busy = Date.now() - start < busyForMs;
        emitLater([
          busy ? '<Run|MPos:10.000,0.000,0.000|FS:1000,0>' : '<Idle|MPos:40.000,0.000,0.000|FS:0,0>',
        ]);
        return;
      }
      if (data === '$$\n') emitLater(['$30=1000', '$31=0', '$32=1', 'ok']);
      if (data === '$I\n') emitLater(['[VER:1.1h.20190830:]', '[OPT:VM,15,128]', 'ok']);
      if (data === '$G\n') emitLater(['[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]', 'ok']);
    },
    onLine: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
  };
  return { connection, writes, queryTimes };
}

function adapter(connection: SerialConnection): PlatformAdapter {
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

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  vi.restoreAllMocks();
});

// A board that reboots when the port opens and prints boot text before its
// banner. The timeline follows FluidNC v4.0.3 setup(): `[MSG:INFO: ...]` lines
// are logged during setup (FluidNC/src/Main.cpp setup(), log_info("FluidNC " ...)),
// input is only polled once protocol_main_loop() calls start_polling()
// (FluidNC/src/Protocol.cpp#L240-L242), and protocol_reset() flushes RX before
// printing the banner (Protocol.cpp#L396-L397: allChannels.flushRx();
// report_init_message(allChannels);). A `?` sent before the banner therefore
// gets no Idle reply. Whether a given ESP32 board resets on open depends on its
// DTR/RTS auto-reset wiring, which firmware source does not settle (PLAUSIBLE).
function rebootingBoardWithBootText(bannerAtMs: number): Controller {
  const handlers = new Set<(line: string) => void>();
  const writes: string[] = [];
  const queryTimes: number[] = [];
  const start = Date.now();
  const emit = (lines: ReadonlyArray<string>): void => {
    for (const line of lines) for (const handler of [...handlers]) handler(line);
  };
  const emitLater = (lines: ReadonlyArray<string>, delayMs = 5): void => {
    setTimeout(() => emit(lines), delayMs);
  };
  const booted = (): boolean => Date.now() - start >= bannerAtMs;
  setTimeout(() => emit(['[MSG:INFO: FluidNC v4.0.3 https://github.com/bdring/FluidNC]']), 150);
  setTimeout(() => emit(['[MSG:INFO: Local filesystem is FLASH]']), 300);
  setTimeout(
    () => emit(['', "Grbl 3.9 [FluidNC v4.0.3 (esp32-wifi) '$' for help]"]),
    bannerAtMs,
  );
  const connection: SerialConnection = {
    write: async (data) => {
      writes.push(data);
      if (!booted()) return; // flushed by protocol_reset() before the banner
      if (data === '?') {
        queryTimes.push(Date.now() - start);
        emitLater(['<Idle|MPos:0.000,0.000,0.000|FS:0,0>']);
        return;
      }
      if (data === '$$\n') emitLater(['$30=1000', '$31=0', '$32=1', 'ok']);
      if (data === '$I\n') emitLater(['[VER:3.9 FluidNC v4.0.3:]', '[OPT:PHS]', 'ok']);
      if (data === '$G\n') emitLater(['[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]', 'ok']);
    },
    onLine: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
  };
  return { connection, writes, queryTimes };
}

describe('TC-1 connect handshake while the controller is still busy', () => {
  it('qualifies a controller that reports Run at connect and reaches Idle 3 s later', async () => {
    const controller = busyThenIdleController(3_000);
    await useLaserStore.getState().connect(adapter(controller.connection));
    await vi.advanceTimersByTimeAsync(20_000);

    const state = useLaserStore.getState();
    // Diagnostics for the report: when the host asked for status.
    console.info('status queries at ms:', controller.queryTimes.slice(0, 6).join(', '));
    console.info('qualification:', JSON.stringify(state.controllerQualification));
    expect(state.statusReport?.state).toBe('Idle');
    expect(state.controllerQualification).toMatchObject({ kind: 'qualified' });
  });

  it('qualifies a board that prints boot text before its banner within a few seconds', async () => {
    const controller = rebootingBoardWithBootText(1_200);
    await useLaserStore.getState().connect(adapter(controller.connection));
    let qualifiedAtMs: number | null = null;
    for (let elapsed = 250; elapsed <= 15_000 && qualifiedAtMs === null; elapsed += 250) {
      await vi.advanceTimersByTimeAsync(250);
      if (useLaserStore.getState().controllerQualification.kind === 'qualified') {
        qualifiedAtMs = elapsed;
      }
    }

    console.info('boot-text board: first status query after the banner at ms:', controller.queryTimes[0]);
    console.info('boot-text board: qualified at ms:', qualifiedAtMs);
    // Banner at 1.2 s; one `?` round trip and three short exchanges follow.
    expect(qualifiedAtMs).not.toBeNull();
    expect(qualifiedAtMs ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(4_000);
  });
});
