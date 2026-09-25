// Audit repro GP-5 (GRBL 1.1 protocol core).
//
// Correct behaviour: GRBL 1.1h stores `$x=` values by type (settings.c
// settings_store_global_setting): $0-$6, $10, $13, $20-$23, $26 and $32 go
// through `uint8_t int_value = trunc(value);` (fraction dropped; values above
// 255 do not fit a uint8 — C leaves the out-of-range conversion undefined, AVR
// wraps it), while floats are reported back by `$$` with printFloat() at
// N_DECIMAL_SETTINGVALUE = 3 decimals ($30/$31 at N_DECIMAL_RPMVALUE = 0).
// None of these is an `error:` — GRBL answers `ok`. A guarded write that
// verifies by exact re-read must therefore refuse, before sending, a value
// GRBL cannot store or report as typed; otherwise it changes the controller
// and then tells the operator the write failed.
//
// Upstream: https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/settings.c#L193-L303
//           https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/report.c#L94-L103
//           https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/config.h#L146-L147
//
// This test FAILS on current code: `$11=0.0105` and `$26=300` are sent, GRBL
// applies 0.0105 (reported 0.011) and 44, and the store then reports
// "Controller did not report ... after re-read".

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from '../../ui/state/laser-store';
import { respondToStockGrblHandshakeQuery } from '../../ui/state/laser-controller-handshake.test-support';
import { flushConnect } from '../../ui/state/laser-store-console.test-support';

type FakeConnection = SerialConnection & { readonly emitLine: (line: string) => void };

const UINT8_SETTINGS = new Set([0, 1, 2, 3, 4, 5, 6, 10, 13, 20, 21, 22, 23, 26, 32]);

function grblPrint(id: number, value: number): string {
  if (UINT8_SETTINGS.has(id)) return String(Math.trunc(value) & 0xff);
  const decimals = id === 30 || id === 31 ? 0 : 3;
  return (Math.round(value * 10 ** decimals) / 10 ** decimals).toFixed(decimals);
}

function makeGrbl(writes: string[]): FakeConnection {
  const handlers = new Set<(line: string) => void>();
  const emitLine = (line: string): void => {
    for (const handler of handlers) handler(line);
  };
  const stored = new Map<number, number>([
    [10, 1],
    [11, 0.01],
    [13, 0],
    [22, 1],
    [26, 250],
    [30, 1000],
    [32, 1],
  ]);
  const dump = (): string[] => [...stored].map(([id, value]) => `$${id}=${grblPrint(id, value)}`);
  return {
    write: async (data) => {
      writes.push(data);
      if (respondToStockGrblHandshakeQuery(data, emitLine)) return;
      const later = (lines: ReadonlyArray<string>): void => {
        queueMicrotask(() => queueMicrotask(() => lines.forEach(emitLine)));
      };
      if (data === '?') return later(['<Idle|MPos:0.000,0.000,0.000|FS:0,0>']);
      if (data === '$$\n') return later([...dump(), 'ok']);
      const write = /^\$(\d+)=(.+)\n$/.exec(data);
      if (write !== null) {
        stored.set(Number(write[1]), Number(write[2]));
        return later(['ok']);
      }
      if (data.endsWith('\n')) later(['ok']);
    },
    onLine: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    emitLine,
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

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  vi.restoreAllMocks();
});

describe('GP-5: guarded settings writes vs GRBL storage/report precision', () => {
  it.each([
    { id: 11, value: '0.0105' },
    { id: 26, value: '300' },
  ])('setting $id = $value is not sent and then reported as a failed write', async ({ id, value }) => {
    const writes: string[] = [];
    const connection = makeGrbl(writes);
    await useLaserStore.getState().connect(adapterFor(connection));
    connection.emitLine("Grbl 1.1h ['$' for help]");
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flushConnect();
    for (const line of ['$10=1', '$11=0.010', '$13=0', '$22=1', '$26=250', '$30=1000', '$32=1']) {
      connection.emitLine(line);
    }
    connection.emitLine('ok');
    await flushConnect();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await useLaserStore.getState().requestControllerStatus();
    await new Promise((resolve) => setTimeout(resolve, 20));

    let failure: string | null = null;
    try {
      await useLaserStore.getState().writeGrblSetting(id, value);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    const sent = writes.includes(`$${id}=${value}\n`);
    // Correct: refused before sending, or verified. Never "sent, then failed".
    expect({ sent, failure }).not.toMatchObject({
      sent: true,
      failure: expect.stringMatching(/did not report/),
    });
  }, 20_000);
});
