// TC-3 repro: Disconnect on Smoothieware closes the port without waiting for
// the controller to take its queued cleanup lines.
//
// Correct behaviour: a controller without a realtime reset path for this state
// (idle, Manual Air on: KerfDesk sends no Ctrl-X) only turns the air off when it
// actually parses the queued `M9`. Smoothieware's USB serial discards whatever
// is still in its receive buffer when the host drops DTR, which closing the
// port does:
//   USBCDC.cpp CDC_SET_CONTROL_LINE_STATE: `if (transfer.setup.wValue & CDC_CLS_DTR) on_attach(); else on_detach();`
//   https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/libs/USBDevice/USBSerial/USBCDC.cpp#L183-L189
//   USBSerial.cpp on_main_loop(): on the detach it runs `txbuf.flush(); rxbuf.flush(); nl_in_rx = 0;`
//   BEFORE it dispatches any buffered line (one line per main-loop pass).
//   https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/libs/USBDevice/USBSerial/USBSerial.cpp#L322-L366
// Smoothieware answers each parsed line with `ok`, so the host can know the
// cleanup escaped the flush by waiting (bounded) for those acknowledgements
// before closing. KerfDesk already owes them on its untracked-ack ledger.
//
// Current behaviour: runOwnedIntentionalDisconnect awaits only the transport
// write of `M5\n` and `M9\n` (stopBeforeDisconnect -> safeWrite), then closes
// the port immediately. This test's controller answers each line 20 ms after
// it arrives; close() is called before either `ok`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from '../../ui/state/laser-store';

type Event = { readonly at: number; readonly what: string };

function smoothieBoard(events: Event[]): SerialConnection {
  const handlers = new Set<(line: string) => void>();
  const start = Date.now();
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
  return {
    write: async (data) => {
      log(`tx ${JSON.stringify(data)}`);
      if (data === '?') emitLater(['<Idle|MPos:0.0000,0.0000,0.0000|WPos:0.0000,0.0000,0.0000>'], 5);
      else if (data.endsWith('\n')) emitLater(['ok'], 20);
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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TC-3 Smoothieware Disconnect with Manual Air on', () => {
  it('waits for the controller to take M5/M9 before closing the port', async () => {
    const events: Event[] = [];
    const board = smoothieBoard(events);
    await useLaserStore.getState().connect(adapter(board), { controllerKind: 'smoothieware' });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(useLaserStore.getState().connection.kind).toBe('connected');
    useLaserStore.setState({ airAssistOn: true });

    const disconnecting = useLaserStore.getState().disconnect();
    await vi.advanceTimersByTimeAsync(2_000);
    await disconnecting;

    const tail = events.filter((event) => event.at >= 3_000);
    console.info(tail.map((event) => `${event.at} ms ${event.what}`).join('\n'));
    const closeAt = tail.find((event) => event.what === 'close')?.at ?? -1;
    const cleanupAcks = tail.filter((event) => event.what === 'rx ok' && event.at <= closeAt);
    expect(tail.some((event) => event.what === 'tx "M9\\n"')).toBe(true);
    // Both cleanup lines must be acknowledged (parsed) before DTR drops.
    expect(cleanupAcks.length).toBeGreaterThanOrEqual(2);
  });
});
