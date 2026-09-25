// Audit repro GP-4 (GRBL 1.1 protocol core).
//
// Correct behaviour: `$C` toggles GRBL 1.1h's check-G-code mode. Entering it
// needs IDLE (`if (sys.state) { return(STATUS_IDLE_ERROR); }`); the ONLY way
// out, other than a soft reset, is a second `$C` sent while the controller
// reports `Check` (`if ( sys.state == STATE_CHECK_MODE ) { mc_reset();
// report_feedback_message(MESSAGE_DISABLED); }`). The wiki: "To disable the
// 'check G-code' mode, send another `$C` system command and Grbl will
// automatically soft-reset". The Console lets an operator enter check mode
// from Idle, so it must accept `$C` while the controller reports `Check`.
//
// Upstream: https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L147-L159
//           https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface ("check G-code" mode paragraph)
//
// This test FAILS on current code: `$C` is classified as ordinary G-code with
// requiresIdle, so the Console refuses it while GRBL reports Check.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from '../../ui/state/laser-store';
import { respondToStockGrblHandshakeQuery } from '../../ui/state/laser-controller-handshake.test-support';
import { flushConnect } from '../../ui/state/laser-store-console.test-support';

type FakeConnection = SerialConnection & { readonly emitLine: (line: string) => void };

function makeGrblInCheckMode(writes: string[]): FakeConnection {
  const handlers = new Set<(line: string) => void>();
  const emitLine = (line: string): void => {
    for (const handler of handlers) handler(line);
  };
  let checkMode = false;
  return {
    write: async (data) => {
      writes.push(data);
      if (respondToStockGrblHandshakeQuery(data, emitLine)) return;
      const later = (lines: ReadonlyArray<string>): void => {
        queueMicrotask(() => queueMicrotask(() => lines.forEach(emitLine)));
      };
      if (data === '?') {
        later([`<${checkMode ? 'Check' : 'Idle'}|MPos:0.000,0.000,0.000|FS:0,0>`]);
        return;
      }
      if (data === '$C\n') {
        if (checkMode) {
          checkMode = false;
          later(['[MSG:Disabled]', 'ok', "Grbl 1.1h ['$' for help]"]);
        } else {
          checkMode = true;
          later(['[MSG:Enabled]', 'ok']);
        }
        return;
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

describe('GP-4: $C check mode', () => {
  it('lets the Console send the second $C that exits check mode', async () => {
    const writes: string[] = [];
    const connection = makeGrblInCheckMode(writes);
    await useLaserStore.getState().connect(adapterFor(connection));
    connection.emitLine("Grbl 1.1h ['$' for help]");
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flushConnect();
    connection.emitLine('$10=1');
    connection.emitLine('ok');
    await flushConnect();

    await useLaserStore.getState().sendConsoleCommand('$C'); // enter (allowed from Idle)
    await flushConnect();
    await useLaserStore.getState().requestControllerStatus();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(useLaserStore.getState().statusReport?.state).toBe('Check');

    writes.length = 0;
    let refusal: string | null = null;
    try {
      await useLaserStore.getState().sendConsoleCommand('$C'); // exit
    } catch (error) {
      refusal = error instanceof Error ? error.message : String(error);
    }
    expect.soft(refusal).toBeNull();
    expect(writes).toContain('$C\n');
  }, 20_000);
});
