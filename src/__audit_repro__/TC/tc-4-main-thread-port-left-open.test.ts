// @vitest-environment node
//
// TC-4 repro: when the main-thread transport's read side ends on its own (a
// read error it does not recover from, or an exhausted recovery budget), the
// session is reported closed but the port itself is never closed.
//
// Correct behaviour (parity with the worker transport, which closes its own
// port after its read side ends: native-serial-worker-runtime.ts closeRuntime
// -> port.close()): the Web Serial spec's own read-loop example closes the port
// after the loop ends "so that the port is also closed when a fatal error is
// encountered and port.readable becomes null" (https://wicg.github.io/serial/
// section 4.10 close(), Example 7). An UnknownError does not set [[readFatal]]
// (spec 4.6 readable: only "If the port was disconnected" sets it), so the OS
// port stays open and held by the page until the next Connect's stale-port
// sweep or a reload.
//
// Current behaviour: web-serial.ts handleDroppedConnection() only releases the
// streams and fires close; it never calls port.close().

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SerialConnection } from '../../platform/types';
import { SerialPortDouble, waitFor } from '../../platform/web/serial-port-double.test-support';
import { webSerial } from '../../platform/web/web-serial';

async function connect(port: SerialPortDouble): Promise<{
  readonly connection: SerialConnection;
  readonly closes: () => number;
}> {
  vi.stubGlobal('navigator', {
    serial: { getPorts: async () => [], requestPort: async () => port },
  });
  const ref = await webSerial.requestPort();
  if (ref === null) throw new Error('expected a port');
  const connection = await ref.open({ baudRate: 115200 });
  let closes = 0;
  connection.onClose(() => {
    closes += 1;
  });
  return { connection, closes: () => closes };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TC-4 main-thread transport closes its port when the read side ends on its own', () => {
  it('closes the port after an UnknownError ends the session', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const port = new SerialPortDouble();
    const session = await connect(port);

    port.readError('UnknownError');
    await waitFor(() => session.closes() === 1, 'the session to end');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(port.opened).toBe(false);
  });

  it('closes the port after the line-error recovery budget is exhausted', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const port = new SerialPortDouble();
    const session = await connect(port);

    port.failFreshStreams = 'BreakError';
    port.readError('BreakError');
    await waitFor(() => session.closes() === 1, 'the session to end');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(port.opened).toBe(false);
  });
});
