// Audit TC-1: the connect handshake asked for status once, then waited 8 s for
// a fresh Idle that nothing solicited. GRBL reports status only when asked
// (grbl protocol.c protocol_exec_rt_system: "if (rt_exec & EXEC_STATUS_REPORT)
// { report_realtime_status(); ...}"), and the ordinary status poll starts only
// when the handshake returns, so a controller that was still busy when the port
// opened (buffered motion draining on a board whose USB port does not reset it,
// a Jog, a Hold or Door) latched "Timed out waiting for fresh Idle." and a
// failed qualification that nothing re-ran once the machine reached Idle. A
// board that reboots on open and prints boot text before its banner (FluidNC
// v4.0.3 setup() logs `[MSG:INFO: ...]`, then protocol_reset() flushes RX and
// prints the banner, Protocol.cpp#L396-L397) swallowed the one query and held
// the handshake for 8.5 s.
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L250-L253

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';

type Controller = {
  readonly connection: SerialConnection;
  readonly queryTimes: number[];
};

type Script = {
  /** Status line for a `?` at `elapsedMs`, or null when the query goes unanswered. */
  readonly status: (elapsedMs: number) => string | null;
  /** Lines emitted unprompted, at the given times. */
  readonly unprompted?: ReadonlyArray<readonly [number, ReadonlyArray<string>]>;
  /** False while the board is still booting: everything written is dropped. */
  readonly listening?: (elapsedMs: number) => boolean;
  readonly buildInfo?: ReadonlyArray<string>;
  /** Lines to answer any other written line with. */
  readonly reply?: (data: string) => ReadonlyArray<string>;
};

const IDLE = '<Idle|MPos:40.000,0.000,0.000|FS:0,0>';
const RUN = '<Run|MPos:10.000,0.000,0.000|FS:1000,0>';

function scriptedController(script: Script): Controller {
  const handlers = new Set<(line: string) => void>();
  const queryTimes: number[] = [];
  const start = Date.now();
  const emit = (lines: ReadonlyArray<string>): void => {
    for (const line of lines) for (const handler of [...handlers]) handler(line);
  };
  const emitLater = (lines: ReadonlyArray<string>): void => {
    setTimeout(() => emit(lines), 5);
  };
  for (const [atMs, lines] of script.unprompted ?? []) setTimeout(() => emit(lines), atMs);
  const connection: SerialConnection = {
    write: async (data) => {
      const elapsed = Date.now() - start;
      if (script.listening !== undefined && !script.listening(elapsed)) return;
      if (data === '?') {
        queryTimes.push(elapsed);
        const status = script.status(elapsed);
        if (status !== null) emitLater([status]);
        return;
      }
      if (data === '$$\n') emitLater(['$30=1000', '$31=0', '$32=1', 'ok']);
      if (data === '$I\n') {
        emitLater([...(script.buildInfo ?? ['[VER:1.1h.20190830:]', '[OPT:VM,15,128]']), 'ok']);
      }
      if (data === '$G\n') emitLater(['[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]', 'ok']);
      const reply = script.reply?.(data) ?? [];
      if (reply.length > 0) emitLater(reply);
    },
    onLine: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
  };
  return { connection, queryTimes };
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

async function msUntilQualified(limitMs: number): Promise<number | null> {
  for (let elapsed = 250; elapsed <= limitMs; elapsed += 250) {
    await vi.advanceTimersByTimeAsync(250);
    if (useLaserStore.getState().controllerQualification.kind === 'qualified') return elapsed;
  }
  return null;
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

describe('connect handshake while the controller is still busy (audit TC-1)', () => {
  it('qualifies a controller that reports Run at connect and reaches Idle 3 s later', async () => {
    const controller = scriptedController({ status: (ms) => (ms < 3_000 ? RUN : IDLE) });
    await useLaserStore.getState().connect(adapter(controller.connection));

    const qualifiedAt = await msUntilQualified(20_000);

    expect(qualifiedAt).not.toBeNull();
    expect(qualifiedAt ?? Infinity).toBeLessThan(4_000);
    expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
    expect(useLaserStore.getState().lastWriteError).toBeNull();
  });

  it('asks for status on the status-poll cadence while it waits', async () => {
    const controller = scriptedController({ status: (ms) => (ms < 3_000 ? RUN : IDLE) });
    await useLaserStore.getState().connect(adapter(controller.connection));
    await vi.advanceTimersByTimeAsync(3_200);

    const waitQueries = controller.queryTimes.filter((ms) => ms >= 550 && ms < 3_000);
    const gaps = waitQueries.slice(1).map((ms, index) => ms - (waitQueries[index] ?? ms));
    expect(waitQueries.length).toBeGreaterThanOrEqual(9);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(260);
  });

  it('hands a controller still busy after the bounded wait to the scheduler, which keeps waiting', async () => {
    const controller = scriptedController({ status: (ms) => (ms < 20_000 ? RUN : IDLE) });
    await useLaserStore.getState().connect(adapter(controller.connection));
    await vi.advanceTimersByTimeAsync(7_000);
    expect(useLaserStore.getState().controllerOperation?.kind).toBe('connection-handshake');

    // The handshake releases its operation; the busy controller's fresh Run
    // reports keep qualification pending, well past the scheduler's own 8 s.
    await vi.advanceTimersByTimeAsync(10_000);
    const busy = useLaserStore.getState();
    expect(busy.controllerOperation).toBeNull();
    expect(busy.controllerQualification.kind).toBe('qualifying');
    expect(busy.lastWriteError).toBeNull();

    expect(await msUntilQualified(10_000)).not.toBeNull();
  });

  it('releases the handshake so the Console can take a controller out of Check mode', async () => {
    // A board that does not reset on open, left in Check mode: every query
    // answers Check. The Console's `$C` needs the handshake's operation gone.
    let checkMode = true;
    const controller = scriptedController({
      status: () => (checkMode ? '<Check|MPos:0.000,0.000,0.000|FS:0,0>' : IDLE),
      // GRBL leaves Check mode with a second `$C`, which resets (system.c:147-157).
      reply: (data) => {
        if (data !== '$C\n') return [];
        checkMode = false;
        return ['[MSG:Disabled]', "Grbl 1.1h ['$' for help]"];
      },
    });
    await useLaserStore.getState().connect(adapter(controller.connection));
    await vi.advanceTimersByTimeAsync(9_000);

    await expect(useLaserStore.getState().sendConsoleCommand('$C')).resolves.toBeUndefined();
    expect(await msUntilQualified(5_000)).not.toBeNull();
  });

  it('hands a silent wait to the qualification scheduler instead of failing', async () => {
    // Answers the handshake's first query, then nothing for 9 s (the Idle
    // wait's status-silence timeout), then Run, then Idle.
    const controller = scriptedController({
      status: (ms) => {
        if (ms < 400) return RUN;
        if (ms < 9_500) return null;
        return ms < 22_000 ? RUN : IDLE;
      },
    });
    await useLaserStore.getState().connect(adapter(controller.connection));
    await vi.advanceTimersByTimeAsync(9_700);

    const handedOver = useLaserStore.getState();
    expect(handedOver.controllerQualification.kind).toBe('qualifying');
    expect(handedOver.controllerOperation).toBeNull();
    expect(handedOver.lastWriteError).toBeNull();

    // Run reports past the scheduler's own 8 s deadline keep it waiting.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualifying');
    expect(await msUntilQualified(5_000)).not.toBeNull();
  });

  it('qualifies a board that prints boot text before its banner within a few seconds', async () => {
    const bannerAtMs = 1_200;
    const controller = scriptedController({
      status: () => '<Idle|MPos:0.000,0.000,0.000|FS:0,0>',
      listening: (ms) => ms >= bannerAtMs,
      unprompted: [
        [150, ['[MSG:INFO: FluidNC v4.0.3 https://github.com/bdring/FluidNC]']],
        [300, ['[MSG:INFO: Local filesystem is FLASH]']],
        [bannerAtMs, ['', "Grbl 3.9 [FluidNC v4.0.3 (esp32-wifi) '$' for help]"]],
      ],
      buildInfo: ['[VER:3.9 FluidNC v4.0.3:]', '[OPT:PHS]'],
    });
    await useLaserStore.getState().connect(adapter(controller.connection));

    const qualifiedAt = await msUntilQualified(15_000);

    // Banner at 1.2 s; one `?` round trip and three short exchanges follow.
    expect(qualifiedAt).not.toBeNull();
    expect(qualifiedAt ?? Infinity).toBeLessThanOrEqual(2_500);
  });

  it('keeps qualification waiting while a banner-reset controller stays in Alarm', async () => {
    let locked = true;
    const controller = scriptedController({
      status: () => (locked ? '<Alarm|MPos:0.000,0.000,0.000|FS:0,0>' : IDLE),
      unprompted: [[1, ["Grbl 1.1h ['$' for help]", "[MSG:'$H'|'$X' to unlock]"]]],
    });
    await useLaserStore.getState().connect(adapter(controller.connection));
    await vi.advanceTimersByTimeAsync(20_000);

    // Alarm reports clear the status observation; the moving report sequence
    // still proves a live controller waiting for the operator (connect-3).
    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualifying');

    locked = false;
    expect(await msUntilQualified(5_000)).not.toBeNull();
  });
});

// Opening the port asserts DTR, which resets an Arduino-class GRBL board; GRBL
// prints its banner from the init loop after it clears RX (grbl main.c#L88,
// #L102). A banner that lands after the 2 s silent-controller verdict must
// still end qualified: the welcome handler re-schedules qualification and the
// status poll that starts after the handshake supplies the fresh Idle.
describe('a reset banner later than the 2 s handshake window', () => {
  it('still qualifies once the late banner and a fresh Idle arrive', async () => {
    const bannerAtMs = 2_600;
    const controller = scriptedController({
      status: () => '<Idle|MPos:0.000,0.000,0.000|FS:0,0>',
      listening: (ms) => ms >= bannerAtMs,
      unprompted: [[bannerAtMs, ['', "Grbl 1.1h ['$' for help]"]]],
    });
    await useLaserStore.getState().connect(adapter(controller.connection));
    await vi.advanceTimersByTimeAsync(2_100);
    expect(useLaserStore.getState().controllerQualification.kind).toBe('failed');

    await vi.advanceTimersByTimeAsync(4_000);
    const state = useLaserStore.getState();
    expect(state.detectedControllerKind).toBe('grbl-v1.1');
    expect(state.controllerQualification).toMatchObject({ kind: 'qualified' });
    expect(state.log.some((line) => line.includes('No controller response'))).toBe(true);
  });
});
