// TC coverage check (PASSES on current code; not a defect repro).
//
// Opening the port asserts DTR (Chromium's Windows serial handler sets
// fDtrControl = DTR_CONTROL_ENABLE and fRtsControl = RTS_CONTROL_ENABLE in
// ConfigurePortImpl; a POSIX tty open raises DTR/RTS), which resets an
// Arduino-class GRBL board. GRBL then prints "\r\nGrbl 1.1h ['$' for help]\r\n"
// from its init loop (grbl/grbl/main.c#L102 report_init_message(), report.c#L172).
// This checks that a banner arriving AFTER KerfDesk's 2 s silent-controller
// window still ends in a qualified session: handleWelcomeLine re-schedules
// qualification and the status poll that starts after the handshake supplies
// the fresh Idle it waits for. Only the earlier "No controller response"
// notice remains in the transcript.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from '../../ui/state/laser-store';

function lateBannerBoard(bannerAtMs: number): SerialConnection {
  const handlers = new Set<(line: string) => void>();
  const start = Date.now();
  const emit = (lines: ReadonlyArray<string>): void => {
    for (const line of lines) for (const handler of [...handlers]) handler(line);
  };
  const emitLater = (lines: ReadonlyArray<string>): void => {
    setTimeout(() => emit(lines), 5);
  };
  setTimeout(() => emit(['', "Grbl 1.1h ['$' for help]"]), bannerAtMs);
  return {
    write: async (data) => {
      if (Date.now() - start < bannerAtMs) return; // still in the bootloader
      if (data === '?') emitLater(['<Idle|MPos:0.000,0.000,0.000|FS:0,0>']);
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

describe('TC check: a reset banner later than the 2 s handshake window', () => {
  it('still qualifies once the late banner and a fresh Idle arrive', async () => {
    await useLaserStore.getState().connect(adapter(lateBannerBoard(2_600)));
    await vi.advanceTimersByTimeAsync(2_100);
    expect(useLaserStore.getState().controllerQualification.kind).toBe('failed');

    await vi.advanceTimersByTimeAsync(4_000);
    const state = useLaserStore.getState();
    expect(state.detectedControllerKind).toBe('grbl-v1.1');
    expect(state.controllerQualification).toMatchObject({ kind: 'qualified' });
    expect(state.log.some((line) => line.includes('No controller response'))).toBe(true);
  });
});
