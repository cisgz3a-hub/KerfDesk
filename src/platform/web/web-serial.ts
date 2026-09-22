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
import { closeWriterBounded } from './bounded-writer-close';
import { EMPTY_SERIAL_LINE_STATE, encodeWireBytes, extractSerialLines } from './serial-wire';
import { createWorkerSerialConnection } from './worker-serial-connection';
import type { SerialWorkerResponse } from './serial-worker-protocol';

// Re-exported: the wire primitives moved to `serial-wire.ts` so the worker
// transport shares them byte for byte (ADR-334).
export { extractSerialLines };

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
      if (req.hostedStreaming === true) {
        const hosted = tryWorkerHostedConnection(port);
        if (hosted !== null) return hosted;
      }
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

// The worker-hosted transport (ADR-334), or null when this runtime cannot give
// it to us: no Worker, a blocked module worker, or a runtime that refuses to
// transfer the port's streams. Every one of those falls back to the
// main-thread connection rather than failing the connect, so opting in can
// never cost the operator their machine.
function tryWorkerHostedConnection(port: SerialPort): SerialConnection | null {
  if (typeof Worker === 'undefined') return null;
  let worker: Worker;
  try {
    worker = new Worker(new URL('./serial-stream-worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch (err) {
    console.warn('Serial worker could not start; streaming stays on the main thread:', err);
    return null;
  }
  const handlers = new Set<(message: SerialWorkerResponse) => void>();
  worker.onmessage = (event: MessageEvent<SerialWorkerResponse>) => {
    for (const handler of handlers) handler(event.data);
  };
  try {
    return createWorkerSerialConnection({
      bridge: {
        postMessage: (message, transfer) =>
          worker.postMessage(message, (transfer ?? []) as Transferable[]),
        onMessage: (handler) => {
          handlers.add(handler);
          return () => handlers.delete(handler);
        },
        terminate: () => worker.terminate(),
      },
      port,
    });
  } catch (err) {
    console.warn('Serial streams could not be handed to the worker:', err);
    worker.terminate();
    return null;
  }
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

// Chromium's default 255-byte serial buffers park the browser-side reader as
// soon as the renderer is late to one read task during a dense `ok` flood
// (~80 ms of job traffic), adding that delay to every ack round trip. A larger
// buffer keeps bytes flowing through ordinary main-thread hiccups so they reach
// the ack loop as one chunk (ADR-331).
export const SERIAL_BUFFER_BYTES = 4096;

// If port.open() throws "port is already open" we try one defensive close
// + reopen before giving up. Covers the case where the stale-port sweep in
// requestPort missed (e.g., a port that opened between getPorts() and now).
async function openWithRetry(port: SerialPort, baudRate: number): Promise<void> {
  const options: SerialOptions = { baudRate, bufferSize: SERIAL_BUFFER_BYTES };
  try {
    await port.open(options);
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
    await port.open(options);
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

async function runReadLoop(
  reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
  lineSubs: Subscribers<string>,
  onEnd: () => void,
): Promise<void> {
  if (reader === undefined) return;
  const decoder = new TextDecoder('utf-8');
  let framing = EMPTY_SERIAL_LINE_STATE;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const extracted = extractSerialLines(framing, decoder.decode(value, { stream: true }));
      framing = extracted.state;
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
    // Bounded, not bare: close() alone never settles on a sink that cannot
    // drain, and nothing above this awaits with a deadline — Disconnect would
    // spin forever and never release the connection ref, so Connect could not
    // replace the port either. See bounded-writer-close.ts for why abort is
    // the fallback rather than the first move.
    await closeWriterBounded(writer);
    try {
      writer.releaseLock();
    } catch {
      // ignore
    }
  }
}
