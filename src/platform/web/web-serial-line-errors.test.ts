// @vitest-environment node
//
// The main-thread Web Serial transport against UART line errors (audit
// connect-1). The Web Serial spec (https://serial.spec.whatwg.org/, the
// `readable` attribute) errors the read stream with BufferOverrunError,
// BreakError, FramingError or ParityError but leaves the port open, and the
// next read of `port.readable` is a fresh stream. Only a lost device is fatal.
// Tearing the session down on a line error stopped a job mid-cut over one
// burst of spindle or laser-PSU noise, and closed the writer so Stop could no
// longer reach a controller that was still running.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SerialConnection } from '../types';
import { MAX_READ_RECOVERIES_WITHOUT_DATA } from './serial-read-recovery';
import { SerialPortDouble, waitFor } from './serial-port-double.test-support';
import { webSerial } from './web-serial';

type Session = {
  readonly connection: SerialConnection;
  readonly lines: string[];
  readonly closes: () => number;
};

async function connect(port: SerialPortDouble): Promise<Session> {
  vi.stubGlobal('navigator', {
    serial: { getPorts: async () => [], requestPort: async () => port },
  });
  const ref = await webSerial.requestPort();
  if (ref === null) throw new Error('expected a port');
  const connection = await ref.open({ baudRate: 115200 });
  const lines: string[] = [];
  let closes = 0;
  connection.onLine((line) => lines.push(line));
  connection.onClose(() => {
    closes += 1;
  });
  port.emit('ok\r\n');
  await waitFor(() => lines.length === 1, 'the first line');
  return { connection, lines, closes: () => closes };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('main-thread serial transport: UART line errors (audit connect-1)', () => {
  it.each(['FramingError', 'ParityError', 'BreakError', 'BufferOverrunError'])(
    'reads on after a %s: no close, later lines arrive, writes still reach the port',
    async (name) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const port = new SerialPortDouble();
      const session = await connect(port);

      port.readError(name);
      port.emit('<Run|MPos:1.000,2.000,0.000|FS:1200,800>\r\nok\r\n');
      await waitFor(() => session.lines.length === 3, 'the lines after the error');
      await session.connection.write('!');
      await waitFor(() => port.transmitted.includes('!'), 'the feed hold');

      expect(session.lines).toEqual(['ok', '<Run|MPos:1.000,2.000,0.000|FS:1200,800>', 'ok']);
      expect(session.closes()).toBe(0);
      expect(port.streamsCreated).toBe(2);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(name));
    },
  );

  it('drops the record a line error cut short instead of gluing it to the next stream', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const port = new SerialPortDouble();
    const session = await connect(port);

    port.emit('<Idle|MPos:1.');
    await settle();
    port.readError('FramingError');
    port.emit('9,0,0>\r\nok\r\n');
    await waitFor(() => session.lines.length === 3, 'the lines after the error');

    // Bytes went missing at the error; joined, the halves would read as a
    // plausible but wrong position ('<Idle|MPos:1.9,0,0>').
    expect(session.lines).toEqual(['ok', '9,0,0>', 'ok']);
  });

  it('Disconnect after a recovered line error cancels the live reader and closes the port', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const port = new SerialPortDouble();
    const session = await connect(port);
    port.readError('BreakError');
    port.emit('ok\r\n');
    await waitFor(() => session.lines.length === 2, 'the line after the error');

    await session.connection.close();

    // A stale reader left the fresh stream locked, and close() would fail.
    expect(port.opened).toBe(false);
    expect(session.closes()).toBe(1);
  });

  it('control: a cable pull still ends the session exactly once', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const port = new SerialPortDouble();
    const session = await connect(port);

    port.unplug();
    await settle();

    expect(session.closes()).toBe(1);
    await expect(session.connection.write('?')).rejects.toThrow();
  });

  it('still ends the session on a read error that does not leave the port usable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const port = new SerialPortDouble();
    const session = await connect(port);

    port.readError('UnknownError');
    await settle();

    expect(session.closes()).toBe(1);
    expect(port.streamsCreated).toBe(1);
  });

  it('gives up when every fresh stream fails before delivering a byte', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const port = new SerialPortDouble();
    const session = await connect(port);

    port.failFreshStreams = 'FramingError';
    port.readError('FramingError');
    await waitFor(() => session.closes() === 1, 'the session to end');

    // The first stream, then one fresh stream per recovery the budget allows.
    expect(port.streamsCreated).toBe(1 + MAX_READ_RECOVERIES_WITHOUT_DATA);
  });
});
