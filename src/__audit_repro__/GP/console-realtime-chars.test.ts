// Audit repro GP-3 (GRBL 1.1 protocol core).
//
// Correct behaviour: GRBL 1.1h's serial RX interrupt executes `?`, `~`, `!`
// and 0x18 as realtime commands wherever they appear in the byte stream,
// before any line or comment parsing (serial.c ISR(SERIAL_RX): `case
// CMD_FEED_HOLD: system_set_exec_state_flag(EXEC_FEED_HOLD)`; the byte is not
// stored). A feed hold received while Idle sets `sys.suspend =
// SUSPEND_HOLD_COMPLETE; sys.state = STATE_HOLD` and protocol_execute_realtime
// then stays in protocol_exec_rt_suspend's `while (sys.suspend)` loop, so the
// rest of the line is not parsed and no `ok` is sent until a cycle start `~`
// (or reset). A Console line (or saved macro) that contains `!` — bare, or
// inside a `( )`/`;` comment — must therefore not be queued as ordinary
// G-code: send the realtime byte alone (as the Console already does for `?`)
// or refuse the line, the way console-text.ts already refuses bytes above
// 0x7E for the same reason.
//
// Upstream: https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/serial.c#L143-L198
//           https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L252-L290 (hold from Idle)
//           https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L546 (`while (sys.suspend)`)
//           https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/config.h#L51-L54 (CMD_* = 0x18 ? ~ !)
//
// This test FAILS on current code: `!` is queued inside the line, the store
// owes an ack that GRBL (held) never sends, and the Console then refuses `~`
// because the controller is not Idle.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { prepareConsoleCommand } from '../../core/controllers/grbl/console-command';
import { useLaserStore } from '../../ui/state/laser-store';
import { respondToStockGrblHandshakeQuery } from '../../ui/state/laser-controller-handshake.test-support';
import { flushConnect } from '../../ui/state/laser-store-console.test-support';

type FakeConnection = SerialConnection & { readonly emitLine: (line: string) => void };

// Models only the realtime-byte behaviour quoted above.
function makeGrbl(writes: string[]): FakeConnection {
  const handlers = new Set<(line: string) => void>();
  const emitLine = (line: string): void => {
    for (const handler of handlers) handler(line);
  };
  let held = false;
  return {
    write: async (data) => {
      writes.push(data);
      if (respondToStockGrblHandshakeQuery(data, emitLine)) return;
      const later = (line: string): void => {
        queueMicrotask(() => queueMicrotask(() => emitLine(line)));
      };
      if (data === '?') {
        later(`<${held ? 'Hold:0' : 'Idle'}|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>`);
        return;
      }
      if (data.includes('!')) held = true; // ISR: feed hold, line never parsed while held
      if (held) return;
      if (data.endsWith('\n')) later('ok');
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

describe('GP-3: GRBL realtime characters inside Console lines', () => {
  it('does not queue a feed-hold byte as part of a G-code line', () => {
    for (const input of ['!', 'M8 (air on!)', 'G0 X10 ; go!']) {
      const prepared = prepareConsoleCommand(input);
      const queuedWithHold = prepared.ok && prepared.command.wire.endsWith('\n');
      expect.soft(queuedWithHold && prepared.command.wire.includes('!'), input).toBe(false);
    }
  });

  it('a Console line containing `!` leaves the store owing an ack GRBL never sends', async () => {
    const writes: string[] = [];
    const connection = makeGrbl(writes);
    await useLaserStore.getState().connect(adapterFor(connection));
    connection.emitLine("Grbl 1.1h ['$' for help]");
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flushConnect();
    connection.emitLine('$10=1');
    connection.emitLine('ok');
    await flushConnect();

    await useLaserStore.getState().sendConsoleCommand('M8 (air on!)');
    expect(writes).toContain('M8 (air on!)\n');
    // Let the poller/console see the held controller.
    await useLaserStore.getState().requestControllerStatus();
    await flushConnect();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Correct: no acknowledgement is owed for a line GRBL is holding unparsed,
    // and the operator is not locked out of cycle start.
    expect.soft(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    await useLaserStore.getState().sendConsoleCommand('~');
    expect(useLaserStore.getState().lastWriteError ?? '').not.toMatch(/must be Idle/);
  }, 20_000);
});
