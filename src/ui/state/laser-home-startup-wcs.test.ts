// After a successful `$H`, GRBL 1.1h executes the stored `$N0`/`$N1` startup
// blocks (system.c system_execute_line case 'H': `if (!sys.abort) { ...
// if (line[2] == 0) { system_execute_startup(line); } }`) and echoes each one as
// `>line:ok` (report.c report_execute_startup_message). A startup block may
// select G55-G59, so the store re-reads the active WCS with an owned `$G` after
// a Home instead of trusting the one it read before (controller audit
// 2026-09-25 GP-1), and the Frame's G54 normalization then re-selects G54
// before tracing. The emitted laser/CNC program always selects G54
// (grbl-strategy.ts preamble), so a Frame traced in G55 would not match the job.
//
// Upstream: https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L195-L199
//           https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/report.c#L361-L367

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { respondToTestGrblHandshake, settleTestGrblHandshake } from './laser-test-start-helpers';
import { normalizeFrameWorkCoordinateSystem } from '../laser/frame-controller-readiness';

type FakeConnection = SerialConnection & { readonly emitLine: (line: string) => void };

// A stock GRBL 1.1h with `$N0=G55` stored. G54 offset is zero, G55 is 100,50.
function makeGrblWithG55StartupBlock(writes: string[]): FakeConnection {
  const handlers = new Set<(line: string) => void>();
  const emitLine = (line: string): void => {
    for (const handler of handlers) handler(line);
  };
  let activeWcs: 'G54' | 'G55' = 'G54';
  const wco = (): string => (activeWcs === 'G55' ? '100.000,50.000,0.000' : '0.000,0.000,0.000');
  const connection: FakeConnection = {
    write: async (data) => {
      writes.push(data);
      respondToTestGrblHandshake(data, emitLine, `G0 ${activeWcs} G17 G21 G90 G94 M5 M9 T0 F0 S0`);
      const reply = (lines: ReadonlyArray<string>): void => {
        queueMicrotask(() => {
          for (const line of lines) emitLine(line);
        });
      };
      if (data === '?') reply([`<Idle|MPos:0.000,0.000,0.000|FS:0,0|WCO:${wco()}>`]);
      if (data === '$H\n') {
        // system.c: homing completes, then the startup blocks run, then `ok`.
        activeWcs = 'G55';
        reply(['>G55:ok', 'ok']);
      }
      if (data === 'G4 P0.01\n') reply(['ok']);
      if (data === 'G54\n') {
        activeWcs = 'G54';
        reply(['ok']);
      }
      if (
        data === '$G\n' &&
        useLaserStore.getState().controllerOperation?.kind !== 'connection-handshake'
      ) {
        reply([`[GC:G0 ${activeWcs} G17 G21 G90 G94 M5 M9 T0 F0 S0]`, 'ok']);
      }
    },
    onLine: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    emitLine,
  };
  return connection;
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

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  vi.restoreAllMocks();
});

describe('GP-1: GRBL runs $N startup blocks after $H', () => {
  it('does not keep trusting the pre-Home active WCS for Frame normalization', async () => {
    const writes: string[] = [];
    const connection = makeGrblWithG55StartupBlock(writes);
    await useLaserStore.getState().connect(adapterFor(connection));
    connection.emitLine("Grbl 1.1h ['$' for help]");
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|WCO:0.000,0.000,0.000>');
    await flush();
    for (const setting of ['$10=1', '$13=0', '$20=0', '$22=1', '$30=1000', '$32=1']) {
      connection.emitLine(setting);
    }
    connection.emitLine('ok'); // $$ terminal ack
    await settleTestGrblHandshake();
    expect(useLaserStore.getState().activeWcs).toBe('G54');

    await useLaserStore.getState().home();
    expect(useLaserStore.getState().homingState).toBe('confirmed');

    // GRBL is now in G55 (the startup block ran after homing), and the store
    // read it back.
    expect(useLaserStore.getState().activeWcs).toBe('G55');

    // Consequence: Frame's WCS normalization must re-select G54 before tracing.
    writes.length = 0;
    const normalized = await normalizeFrameWorkCoordinateSystem();
    expect(normalized.ok).toBe(true);
    expect(writes).toContain('G54\n');
  }, 20_000);
});
