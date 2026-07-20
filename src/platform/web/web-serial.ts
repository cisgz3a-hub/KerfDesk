// webSerial — SerialAdapter backed by the Web Serial API (Chromium).
//
// Chromium-based browsers (Chrome / Edge / Brave / Arc) expose `navigator.serial`
// with `requestPort()` and the SerialPort objects defined in
// src/vite-env.d.ts. Electron's renderer inherits the same API.
//
// Read pipeline: port.readable → TextDecoderStream → newline splitter →
// `onLine(handler)` callbacks. Write pipeline: string → UTF-8 → port.writable
// (single shared writer per connection).
//
// Disconnect handling: the `disconnect` event fires when the OS drops the
// port (USB cable yank). We surface that via the SerialConnection.onClose
// handlers so the controller state machine can transition to "Disconnected".
//
// Quirk: Chromium and Electron sometimes return a SerialPort instance from
// requestPort() that's still flagged "open" from a previous session
// (the renderer process crashed mid-read, a previous close() didn't await
// the reader cancel, etc.). requestPort() sweeps any stale paired ports
// closed before showing the picker so the user-facing port.open() doesn't
// throw "port is already open".

import type {
  SerialAdapter,
  SerialConnection,
  SerialOpenRequest,
  SerialPortIdentity,
  SerialPortRef,
} from '../types';

export const webSerial: SerialAdapter = {
  isSupported: () => typeof navigator !== 'undefined' && 'serial' in navigator,
  requestPort: async () => {
    await closeStalePairedPorts();
    try {
      const port = await navigator.serial.requestPort();
      return makePortRef(port);
    } catch (err) {
      // Chromium throws DOMException with name "NotFoundError" when the user
      // cancels the picker. Translate to null per our null-means-cancelled
      // contract.
      if (err instanceof DOMException && err.name === 'NotFoundError') return null;
      throw err;
    }
  },
};

// Walk previously-paired ports and close any that's still in the open state.
// `readable` / `writable` are non-null exactly when the port is open. The
// .close() promise can reject if the port is currently locked by a reader;
// we swallow that — the next requestPort cycle gets a fresh handle.
async function closeStalePairedPorts(): Promise<void> {
  try {
    const ports = await navigator.serial.getPorts();
    for (const p of ports) {
      if (p.readable === null && p.writable === null) continue;
      try {
        await p.close();
      } catch {
        // best-effort
      }
    }
  } catch {
    // getPorts() failing is non-fatal; proceed to requestPort.
  }
}

function makePortRef(port: SerialPort): SerialPortRef {
  const info = serialPortIdentity(port);
  return {
    ...(info === null ? {} : { info }),
    open: async (req: SerialOpenRequest): Promise<SerialConnection> => {
      await openWithRetry(port, req.baudRate);
      return makeConnection(port);
    },
    forget: async () => {
      try {
        await port.forget?.();
      } catch (err) {
        console.warn('port.forget() rejected:', err);
      }
    },
  };
}

function serialPortIdentity(port: SerialPort): SerialPortIdentity | null {
  try {
    const info = port.getInfo();
    const usbVendorId = boundedUsbId(info.usbVendorId);
    const usbProductId = boundedUsbId(info.usbProductId);
    if (usbVendorId === undefined && usbProductId === undefined) return null;
    return {
      ...(usbVendorId === undefined ? {} : { usbVendorId }),
      ...(usbProductId === undefined ? {} : { usbProductId }),
    };
  } catch {
    // Identity evidence is diagnostic only; inability to read it must not make
    // a previously usable controller port impossible to open.
    return null;
  }
}

function boundedUsbId(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffff
    ? value
    : undefined;
}

// If port.open() throws "port is already open" we try one defensive close
// + reopen before giving up. Covers the case where the stale-port sweep in
// requestPort missed (e.g., a port that opened between getPorts() and now).
async function openWithRetry(port: SerialPort, baudRate: number): Promise<void> {
  try {
    await port.open({ baudRate });
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/already open/i.test(message)) throw err;
    console.warn('Port already open; closing and retrying once.');
    try {
      await port.close();
    } catch {
      // ignore; the open below will throw if we still can't.
    }
    await port.open({ baudRate });
  }
}

type Subscribers<T> = Set<(value: T) => void>;

function makeConnection(port: SerialPort): SerialConnection {
  const lineSubs: Subscribers<string> = new Set();
  const closeSubs: Subscribers<void> = new Set();
  const ctx = {
    closed: false,
    streamsClosed: false,
    reader: port.readable?.getReader(),
    writer: port.writable?.getWriter(),
  };

  const closeStreamsOnce = async (): Promise<void> => {
    if (ctx.streamsClosed) return;
    ctx.streamsClosed = true;
    await closeStreams(ctx.reader, ctx.writer);
  };

  const fireClose = (): void => {
    if (ctx.closed) return;
    ctx.closed = true;
    for (const h of closeSubs) h();
  };

  const handleDroppedConnection = (): void => {
    port.removeEventListener('disconnect', handleDroppedConnection);
    void closeStreamsOnce();
    fireClose();
  };
  port.addEventListener('disconnect', handleDroppedConnection);

  void runReadLoop(ctx.reader, lineSubs, handleDroppedConnection);

  const closeConnection = async (): Promise<void> => {
    if (ctx.closed) return;
    ctx.closed = true;
    port.removeEventListener('disconnect', handleDroppedConnection);
    await closeStreamsOnce();
    try {
      await port.close();
    } catch (err) {
      console.warn('port.close() rejected:', err);
    }
    for (const h of closeSubs) h();
  };

  let forgetPromise: Promise<void> | null = null;
  const forgetConnection = (): Promise<void> => {
    forgetPromise ??= (async () => {
      const needsClose = !ctx.closed;
      if (needsClose) {
        ctx.closed = true;
        port.removeEventListener('disconnect', handleDroppedConnection);
        await closeStreamsOnce();
        try {
          await port.close();
        } catch (err) {
          console.warn('port.close() rejected:', err);
        }
      }
      // Permission revocation remains valid after a prior normal close. A
      // late concurrent Forget must not become a no-op merely because the
      // transport owner already marked the duplex stream closed.
      try {
        await port.forget?.();
      } catch (err) {
        console.warn('port.forget() rejected:', err);
      }
      if (needsClose) for (const h of closeSubs) h();
    })();
    return forgetPromise;
  };

  return {
    write: async (data: string) => {
      if (ctx.writer === undefined) throw new Error('Serial port not writable.');
      await ctx.writer.write(encodeWireBytes(data));
    },
    onLine: (handler) => {
      lineSubs.add(handler);
      return () => lineSubs.delete(handler);
    },
    onClose: (handler) => {
      closeSubs.add(handler);
      return () => closeSubs.delete(handler);
    },
    close: closeConnection,
    forget: async () => {
      // A2 audit finding: revoke the in-page permission for this port on
      // explicit Forget Device so a long-running tab doesn't accumulate
      // per-port permissions across many laser sessions. Only do this
      // here — the cable-yank path (disconnect event → fireClose) goes
      // through a different code path and intentionally leaves the
      // pairing so the user can plug back in without re-picking.
      // Chromium 103+ ships forget(); on older runtimes the optional
      // chain is a no-op rather than a TypeError.
      await forgetConnection();
    },
  };
}

// One byte per character, NOT UTF-8 (M12, AUDIT-2026-06-10). GRBL's wire
// protocol is ASCII lines plus single raw realtime bytes above 0x7F
// (jog-cancel 0x85, feed/spindle overrides 0x90–0xA2). TextEncoder turned
// '\x85' into the two bytes 0xC2 0x85 — vanilla GRBL discards unknown high
// bytes, so jog-cancel silently did nothing, and firmwares that buffer them
// would corrupt the following line. Byte-per-char is identical to UTF-8 for
// every ASCII string we emit and exact for the realtime bytes.
function encodeWireBytes(data: string): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 1) {
    const code = data.charCodeAt(i);
    if (code > 0xff) {
      throw new Error(
        `Serial write contains a character that is not a single-byte GRBL code: U+${code.toString(16).toUpperCase()}`,
      );
    }
    out[i] = code;
  }
  return out;
}

// Cap on an in-progress (unterminated) serial line. GRBL status/response lines
// are well under 200 bytes; a device streaming bytes WITHOUT a newline (line
// noise, or a spoofed-device DoS) would otherwise grow the read buffer without
// bound until OOM. Past this length the partial is dropped (security audit 2026-06-14).
const MAX_SERIAL_LINE_LENGTH = 64 * 1024;

// Pure line extractor for the serial read loop: appends `chunk` to `buffer`,
// pulls out every \n-terminated line (trailing \r stripped), and returns the
// remaining partial. An over-length partial (no newline in sight) is dropped so
// the buffer cannot grow without bound; an over-length newline-terminated record
// is dropped before it reaches subscribers. Exported for unit testing.
export function extractSerialLines(
  buffer: string,
  chunk: string,
): { readonly lines: ReadonlyArray<string>; readonly buffer: string } {
  let next = buffer + chunk;
  const lines: string[] = [];
  let nl = next.indexOf('\n');
  while (nl >= 0) {
    const line = next.slice(0, nl).replace(/\r$/, '');
    if (line.length <= MAX_SERIAL_LINE_LENGTH) lines.push(line);
    next = next.slice(nl + 1);
    nl = next.indexOf('\n');
  }
  if (next.length > MAX_SERIAL_LINE_LENGTH) next = '';
  return { lines, buffer: next };
}

async function runReadLoop(
  reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
  lineSubs: Subscribers<string>,
  onEnd: () => void,
): Promise<void> {
  if (reader === undefined) return;
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const extracted = extractSerialLines(buffer, decoder.decode(value, { stream: true }));
      buffer = extracted.buffer;
      for (const line of extracted.lines) dispatchLine(lineSubs, line);
    }
  } catch (err) {
    console.error('Serial read loop terminated:', err);
  } finally {
    onEnd();
  }
}

// Subscriber exceptions must not masquerade as a dropped cable: before this
// isolation, one throwing handler exited the read loop through catch/finally,
// closed the streams, and fired onClose — a full mid-job "port closed" — and
// silently dropped the rest of the chunk's lines. Loop-fatal behavior is
// reserved for genuine stream errors from reader.read().
function dispatchLine(lineSubs: Subscribers<string>, line: string): void {
  for (const h of lineSubs) {
    try {
      h(line);
    } catch (err) {
      console.error('Serial line handler threw; continuing with remaining lines:', err);
    }
  }
}

// The reader / writer must be cancelled-and-awaited before port.close() —
// otherwise Web Streams throws "cannot close port while a stream is locked"
// and the port leaks in the open state for the next session.
async function closeStreams(
  reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
  writer: WritableStreamDefaultWriter<Uint8Array> | undefined,
): Promise<void> {
  if (reader !== undefined) {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
  if (writer !== undefined) {
    try {
      await writer.close();
    } catch {
      // ignore
    }
    try {
      writer.releaseLock();
    } catch {
      // ignore
    }
  }
}
