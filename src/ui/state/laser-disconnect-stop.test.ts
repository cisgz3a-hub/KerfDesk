// Audit TC-3: Disconnect on a controller that got no realtime reset closed the
// port in the same millisecond it wrote `M5` and `M9`. Closing drops DTR, and
// Smoothieware's USB serial discards whatever it has not parsed yet when the
// host detaches (USBSerial.cpp on_main_loop(): on the detach it runs
// `txbuf.flush(); rxbuf.flush(); nl_in_rx = 0;` before it dispatches the next
// buffered line; USBCDC.cpp CDC_SET_CONTROL_LINE_STATE calls on_detach() when
// DTR drops), so with Manual Air on an unparsed `M9` left the air running while
// KerfDesk showed Disconnected. Smoothieware answers each parsed line with
// `ok`, so the owed acknowledgements prove the cleanup escaped the flush.
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/libs/USBDevice/USBSerial/USBSerial.cpp#L322-L366

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { DISCONNECT_CLEANUP_ACK_WAIT_MS } from './laser-disconnect-stop';
import { useLaserStore } from './laser-store';

type Event = { readonly at: number; readonly what: string };

type Board = {
  readonly connection: SerialConnection;
  readonly events: Event[];
  /** Stop answering newline-terminated lines (a controller that lost them). */
  readonly goSilent: () => void;
};

function smoothieBoard(ackDelayMs = 20): Board {
  const handlers = new Set<(line: string) => void>();
  const events: Event[] = [];
  const start = Date.now();
  let silent = false;
  const log = (what: string): void => {
    events.push({ at: Date.now() - start, what });
  };
  const emitLater = (lines: ReadonlyArray<string>, delayMs: number): void => {
    setTimeout(() => {
      for (const line of lines) {
        log(`rx ${line}`);
        for (const handler of [...handlers]) handler(line);
      }
    }, delayMs);
  };
  // DTR attach greeting (USBSerial.cpp on_main_loop: puts("Smoothie\r\nok\r\n")).
  emitLater(['Smoothie', 'ok'], 5);
  const connection: SerialConnection = {
    write: async (data) => {
      log(`tx ${JSON.stringify(data)}`);
      if (data === '?') {
        emitLater(['<Idle|MPos:0.0000,0.0000,0.0000|WPos:0.0000,0.0000,0.0000>'], 5);
      } else if (data.endsWith('\n') && !silent) {
        emitLater(['ok'], ackDelayMs);
      }
    },
    onLine: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => {
      log('close');
    },
  };
  return {
    connection,
    events,
    goSilent: () => {
      silent = true;
    },
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

async function connectedSmoothie(board: Board): Promise<void> {
  await useLaserStore
    .getState()
    .connect(adapter(board.connection), { controllerKind: 'smoothieware' });
  await vi.advanceTimersByTimeAsync(3_000);
  expect(useLaserStore.getState().connection.kind).toBe('connected');
}

async function disconnectOver(ms: number): Promise<void> {
  const disconnecting = useLaserStore.getState().disconnect();
  await vi.advanceTimersByTimeAsync(ms);
  await disconnecting;
}

function eventsFrom(board: Board, fromMs: number): ReadonlyArray<Event> {
  return board.events.filter((event) => event.at >= fromMs);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Disconnect without a realtime reset waits for the cleanup acks (audit TC-3)', () => {
  it('closes the Smoothieware port only after M5 and M9 are acknowledged', async () => {
    const board = smoothieBoard();
    await connectedSmoothie(board);
    useLaserStore.setState({ airAssistOn: true });

    await disconnectOver(2_000);

    const tail = eventsFrom(board, 3_000);
    const closeAt = tail.find((event) => event.what === 'close')?.at ?? -1;
    const acksBeforeClose = tail.filter((event) => event.what === 'rx ok' && event.at <= closeAt);
    expect(tail.map((event) => event.what)).toEqual(
      expect.arrayContaining(['tx "M5\\n"', 'tx "M9\\n"']),
    );
    expect(tail.some((event) => event.what === 'tx "\\u0018"')).toBe(false);
    expect(acksBeforeClose).toHaveLength(2);
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
  });

  it('closes after the bound when the controller never acknowledges them', async () => {
    const board = smoothieBoard();
    await connectedSmoothie(board);
    useLaserStore.setState({ airAssistOn: true });
    board.goSilent();

    const disconnecting = useLaserStore.getState().disconnect();
    await vi.advanceTimersByTimeAsync(DISCONNECT_CLEANUP_ACK_WAIT_MS - 100);
    expect(eventsFrom(board, 3_000).some((event) => event.what === 'close')).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    await disconnecting;

    expect(eventsFrom(board, 3_000).some((event) => event.what === 'close')).toBe(true);
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    expect(useLaserStore.getState().log.join('\n')).toContain(
      'did not acknowledge the stop commands',
    );
  });

  it('does not wait when nothing needed stopping', async () => {
    const board = smoothieBoard();
    await connectedSmoothie(board);

    await disconnectOver(5);

    const tail = eventsFrom(board, 3_000);
    expect(tail.some((event) => event.what === 'close')).toBe(true);
    expect(tail.some((event) => event.what.startsWith('tx "M'))).toBe(false);
  });
});
