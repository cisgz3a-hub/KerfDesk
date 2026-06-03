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

import type { SerialAdapter, SerialConnection, SerialOpenRequest, SerialPortRef } from '../types';

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
  return {
    open: async (req: SerialOpenRequest): Promise<SerialConnection> => {
      await openWithRetry(port, req.baudRate);
      return makeConnection(port);
    },
  };
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

  return {
    write: async (data: string) => {
      if (ctx.writer === undefined) throw new Error('Serial port not writable.');
      await ctx.writer.write(new TextEncoder().encode(data));
    },
    onLine: (handler) => {
      lineSubs.add(handler);
      return () => lineSubs.delete(handler);
    },
    onClose: (handler) => {
      closeSubs.add(handler);
      return () => closeSubs.delete(handler);
    },
    close: async () => {
      if (ctx.closed) return;
      ctx.closed = true;
      port.removeEventListener('disconnect', handleDroppedConnection);
      await closeStreamsOnce();
      try {
        await port.close();
      } catch (err) {
        console.warn('port.close() rejected:', err);
      }
      // A2 audit finding: revoke the in-page permission for this port on
      // explicit user-disconnect so a long-running tab doesn't accumulate
      // per-port permissions across many laser sessions. Only do this
      // here — the cable-yank path (disconnect event → fireClose) goes
      // through a different code path and intentionally leaves the
      // pairing so the user can plug back in without re-picking.
      // Chromium 103+ ships forget(); on older runtimes the optional
      // chain is a no-op rather than a TypeError.
      try {
        await port.forget?.();
      } catch (err) {
        console.warn('port.forget() rejected:', err);
      }
      for (const h of closeSubs) h();
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
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        for (const h of lineSubs) h(line);
        nl = buffer.indexOf('\n');
      }
    }
  } catch (err) {
    console.error('Serial read loop terminated:', err);
  } finally {
    onEnd();
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
