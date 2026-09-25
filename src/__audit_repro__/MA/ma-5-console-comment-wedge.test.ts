// Audit track MA (Marlin), finding MA-5: a comment-only Console line on
// Marlin reserves an acknowledgement Marlin never sends, and every later
// command is refused until the operator disconnects.
//
// prepareMarlinConsoleCommand accepts '; note' as an ordinary G-code line
// (core/controllers/marlin/console-command.ts: only empty, multi-line, non-ASCII
// and M500/M502 are refused), and console-command-transport.ts writes it with
// one owed acknowledgement. Marlin 2.1.2.8 answers nothing: queue.cpp
// process_stream_char() drops everything after ';' (PS_EOL), and
// process_line_done() reports the resulting empty buffer as empty, so
// get_serial_commands() `continue`s without enqueueing the line — no command
// is processed and ok_to_send() never runs. (With PAREN_COMMENTS enabled a
// '(note)' line behaves the same.) The ledger never expires an owed ack by
// time (ADR-362 Amendment 1, decision 4), so the status poll and every later
// Console, Jog, Frame and Start wait on it.
//
// Upstream: https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/queue.cpp#L369-L405
//           https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/queue.cpp#L464-L468
//
// Correct behaviour: a Console line that Marlin will not acknowledge (blank
// after comment stripping) is refused before it is written, so the next
// command is accepted. The repo's Marlin simulator acks every line, including
// comments, which hides this; the fake below follows queue.cpp instead.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareMarlinConsoleCommand } from '../../core/controllers/marlin/console-command';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from '../../ui/state/laser-store';

const POSITION = 'X:0.00 Y:0.00 Z:0.00 E:0.00 Count X:0 Y:0 Z:0';

/** Marlin 2.1.2.8 queue.cpp: a line that is empty once ';' comments are
 * stripped gets no reply; every other line gets `ok` (M114 first reports). */
function queueCppMarlin(writes: string[]): SerialConnection & { emitLine: (l: string) => void } {
  const handlers = new Set<(line: string) => void>();
  const emitLine = (line: string): void => {
    for (const handler of [...handlers]) handler(line);
  };
  return {
    write: async (data) => {
      writes.push(data);
      for (const raw of data.split('\n').slice(0, -1)) {
        const command = (raw.split(';', 1)[0] ?? '').trim();
        if (command === '') continue; // process_line_done(): empty -> no ok
        setTimeout(() => {
          if (/^M114\b/.test(command)) emitLine(POSITION);
          emitLine('ok');
        }, 1);
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
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MA-5: comment-only Console line wedges a Marlin session', () => {
  it('refuses a line Marlin will never acknowledge', () => {
    // Current code: accepted as an ordinary state-changing G-code line.
    expect(prepareMarlinConsoleCommand('; note').ok).toBe(false);
  });

  it('keeps later commands usable after a comment-only Console line', async () => {
    const writes: string[] = [];
    const connection = queueCppMarlin(writes);
    await useLaserStore
      .getState()
      .connect(adapterFor(connection), { controllerKind: 'marlin', baudRate: 250000 });
    connection.emitLine('start');
    await vi.advanceTimersByTimeAsync(1_500);
    expect(useLaserStore.getState().statusReport?.state).toBe('Idle');

    await useLaserStore
      .getState()
      .sendConsoleCommand('; note')
      .catch(() => undefined);
    await vi.advanceTimersByTimeAsync(5_000);

    // Current code: the ledger still owes the comment's ack, so the next
    // Console command (and every poll, Jog, Frame and Start) is refused.
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    await expect(useLaserStore.getState().sendConsoleCommand('M105')).resolves.toBeUndefined();
  });
});
