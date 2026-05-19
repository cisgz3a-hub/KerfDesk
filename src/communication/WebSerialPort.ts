/**
 * Web Serial API adapter that implements SerialPortLike.
 * Works in Electron's Chromium and Chrome browsers.
 * No native Node.js modules required.
 */

import {
  LINE_TRANSPORT_CAPABILITIES,
  type TransportOpenOptions,
  type Unsubscribe,
} from '../transports/Transport';
import { type SerialPortLike } from './SerialPort';
import { SubscriptionSet } from './TransportSubscription';

/**
 * T3-48: USB descriptor fingerprint used to match a previously-
 * authorized port without re-prompting the user. Captured from
 * `SerialPort.getInfo()` after a successful connect; stored
 * per-profile so reconnects to the same device skip the picker.
 */
export interface DeviceFingerprint {
  readonly usbVendorId?: number;
  readonly usbProductId?: number;
}

/** Result returned by {@link WebSerialPort.connectKnownPortOrPrompt}. */
export interface KnownPortConnectResult {
  /**
   * `true` when a previously-authorized port was opened without a
   * `requestPort()` prompt; `false` when the prompt fallback ran
   * (no fingerprint match, ambiguous multi-port set, or browser
   * does not support `getPorts`).
   */
  readonly usedKnownPort: boolean;
  /** Captured device fingerprint after a successful open. */
  readonly fingerprint?: DeviceFingerprint;
}

export class WebSerialPort implements SerialPortLike {
  readonly kind = 'web-serial';
  readonly capabilities = {
    ...LINE_TRANSPORT_CAPABILITIES,
    userGestureOpenRequired: true,
  };

  private _port: SerialPort | null = null;
  private _reader: ReadableStreamDefaultReader | null = null;
  private _writer: WritableStreamDefaultWriter | null = null;
  private _isOpen = false;
  private _readLoopActive = false;
  private _navigatorDisconnectHandler: ((event: Event & { port?: SerialPort }) => void) | null = null;

  private readonly _dataCallbacks = new SubscriptionSet<[line: string]>();
  private readonly _errorCallbacks = new SubscriptionSet<[error: Error]>();
  private readonly _closeCallbacks = new SubscriptionSet<[]>();

  get isOpen(): boolean { return this._isOpen; }

  static isSupported(): boolean {
    if (typeof navigator === 'undefined') return false;
    return 'serial' in navigator;
  }

  async open(options?: TransportOpenOptions): Promise<void> {
    await this.requestAndOpen(options?.baudRate ?? 115200, options?.signal, options?.serialSignals);
  }

  /**
   * Prompt user to select a serial port and acquire a writer + reader.
   *
   * T2-33: partial-open cleanup. Pre-T2-33 the catch block did NOT
   * release locks, cancel the reader, or close the port if the
   * failure happened AFTER `port.open()` succeeded. The next reconnect
   * could find the port still held by the (failed) previous attempt
   * and reject with "port busy" — a hardware-lifecycle leak. The
   * fix: track every acquisition step in locals, only commit to
   * instance fields after ALL succeed, and unwind in reverse on any
   * failure.
   *
   * T1-50 Part B: optional AbortSignal — caller can cancel a slow
   * `requestPort` / `open` and the unwind path runs identically to
   * a thrown error. The AbortError surfaces with a stable message so
   * UI gates can distinguish user-cancel from transport failure.
   */
  async requestAndOpen(
    baudRate: number = 115200,
    signal?: AbortSignal,
    serialSignals?: SerialOutputSignals,
  ): Promise<void> {
    let port: SerialPort | null = null;
    let portOpened = false;
    let writer: WritableStreamDefaultWriter | null = null;
    let reader: ReadableStreamDefaultReader | null = null;

    try {
      signal?.throwIfAborted();
      port = await (navigator as unknown as {
        serial: { requestPort: () => Promise<SerialPort> };
      }).serial.requestPort();
      signal?.throwIfAborted();

      await port.open({ baudRate });
      portOpened = true;
      signal?.throwIfAborted();
      await applySerialSignals(port, serialSignals);
      signal?.throwIfAborted();

      writer = port.writable?.getWriter() ?? null;
      if (!writer) throw new Error('Failed to acquire writer lock');
      signal?.throwIfAborted();

      reader = port.readable?.getReader() ?? null;
      if (!reader) throw new Error('Failed to acquire reader lock');

      // All acquisitions succeeded — commit to instance fields.
      this._port = port;
      this._writer = writer;
      this._reader = reader;
      this._isOpen = true;
      this._attachNavigatorDisconnectListener(port);
      this._startReadLoop();
    } catch (e: unknown) {
      // Unwind in reverse order. Each unwind step is best-effort; we
      // don't want one failing cleanup to mask the original error.
      if (reader) {
        try { await reader.cancel(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
      }
      if (writer) {
        try { writer.releaseLock(); } catch { /* ignore */ }
      }
      if (portOpened && port) {
        try { await port.close(); } catch { /* ignore */ }
      }
      this._isOpen = false;
      this._port = null;
      this._reader = null;
      this._writer = null;

      if (signal?.aborted) {
        throw new Error('Connection aborted by user');
      }
      const msg = messageFromUnknownError(e);
      throw new Error(`Failed to open serial port: ${msg}`);
    }
  }

  /**
   * T3-48: connect to a previously-authorized port without re-
   * prompting the user. Walks `navigator.serial.getPorts()` looking
   * for a match against `fingerprint`; when no fingerprint is given
   * and exactly one port has been previously authorized, that single
   * port is reused. In every other case the call falls back to the
   * standard `requestAndOpen` prompt.
   *
   * Returns `{ usedKnownPort, fingerprint }`. The fingerprint reflects
   * the actually-opened port's `getInfo()` so callers can persist it
   * to the profile and match the same device on next reconnect.
   *
   * Failure modes are identical to {@link requestAndOpen} — this
   * method delegates to the same try/catch unwind path. Browsers that
   * do not implement `getPorts` (Chrome <89) silently fall through to
   * the prompt path.
   */
  async connectKnownPortOrPrompt(
    baudRate: number = 115200,
    fingerprint?: DeviceFingerprint,
    signal?: AbortSignal,
    serialSignals?: SerialOutputSignals,
  ): Promise<KnownPortConnectResult> {
    signal?.throwIfAborted();
    const known = await WebSerialPort.getKnownPorts();

    let candidate: SerialPort | null = null;
    if (fingerprint && known.length > 0) {
      candidate = known.find((p) => matchesFingerprint(p, fingerprint)) ?? null;
    }
    if (!candidate && !fingerprint && known.length === 1) {
      // Single previously-authorized port and no profile fingerprint
      // to match against → safe to reuse. Multiple known ports without
      // a fingerprint is ambiguous; fall through to the prompt.
      candidate = known[0]!;
    }

    if (candidate) {
      await this._openExistingPort(candidate, baudRate, signal, serialSignals);
      return {
        usedKnownPort: true,
        fingerprint: extractFingerprint(candidate),
      };
    }

    await this.requestAndOpen(baudRate, signal, serialSignals);
    return {
      usedKnownPort: false,
      fingerprint: this._port ? extractFingerprint(this._port) : undefined,
    };
  }

  /**
   * Open a `SerialPort` we already hold a reference to (e.g. one
   * returned by `navigator.serial.getPorts()`). Mirrors the unwind
   * path from {@link requestAndOpen}.
   */
  private async _openExistingPort(
    port: SerialPort,
    baudRate: number,
    signal?: AbortSignal,
    serialSignals?: SerialOutputSignals,
  ): Promise<void> {
    let portOpened = false;
    let writer: WritableStreamDefaultWriter | null = null;
    let reader: ReadableStreamDefaultReader | null = null;

    try {
      signal?.throwIfAborted();
      await port.open({ baudRate });
      portOpened = true;
      signal?.throwIfAborted();
      await applySerialSignals(port, serialSignals);
      signal?.throwIfAborted();

      writer = port.writable?.getWriter() ?? null;
      if (!writer) throw new Error('Failed to acquire writer lock');
      signal?.throwIfAborted();

      reader = port.readable?.getReader() ?? null;
      if (!reader) throw new Error('Failed to acquire reader lock');

      this._port = port;
      this._writer = writer;
      this._reader = reader;
      this._isOpen = true;
      this._attachNavigatorDisconnectListener(port);
      this._startReadLoop();
    } catch (e: unknown) {
      if (reader) {
        try { await reader.cancel(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
      }
      if (writer) {
        try { writer.releaseLock(); } catch { /* ignore */ }
      }
      if (portOpened) {
        try { await port.close(); } catch { /* ignore */ }
      }
      this._isOpen = false;
      this._port = null;
      this._reader = null;
      this._writer = null;

      if (signal?.aborted) {
        throw new Error('Connection aborted by user');
      }
      const msg = messageFromUnknownError(e);
      throw new Error(`Failed to open serial port: ${msg}`);
    }
  }

  /**
   * T3-48: revoke the persistent permission grant for the currently-
   * connected port. Closes the port first (since `forget()` on an
   * open port is implementation-defined). Safe to call when no port
   * is open (no-op).
   */
  async forgetActiveDevice(): Promise<void> {
    const port = this._port;
    if (this._isOpen) {
      await this.close();
    }
    if (!port || typeof port.forget !== 'function') return;
    try {
      await port.forget();
    } catch {
      /* policy-granted permission may reject forget */
    }
  }

  /**
   * T3-48: list previously-authorized ports without prompting the
   * user. Returns an empty array on browsers that do not support
   * `getPorts` (Chrome <89) or when Web Serial is unavailable.
   */
  static async getKnownPorts(): Promise<readonly SerialPort[]> {
    if (!WebSerialPort.isSupported()) return [];
    const serial = (navigator as unknown as {
      serial?: { getPorts?: () => Promise<readonly SerialPort[]> };
    }).serial;
    if (typeof serial?.getPorts !== 'function') return [];
    try {
      return await serial.getPorts();
    } catch {
      return [];
    }
  }

  /**
   * T3-48: revoke persistent grants for known ports matching
   * `fingerprint`. When `fingerprint` is omitted, every previously-
   * authorized port has its grant revoked. Returns the number of
   * grants actually revoked. Used by the "Forget device" UI button
   * and per-profile cleanup paths.
   */
  static async forgetKnownPorts(fingerprint?: DeviceFingerprint): Promise<number> {
    const known = await WebSerialPort.getKnownPorts();
    let forgotten = 0;
    for (const port of known) {
      if (fingerprint && !matchesFingerprint(port, fingerprint)) continue;
      if (typeof port.forget !== 'function') continue;
      try {
        await port.forget();
        forgotten += 1;
      } catch {
        /* policy-granted permission may reject forget */
      }
    }
    return forgotten;
  }

  write(data: string): void {
    if (!this._isOpen || !this._writer) throw new Error('Port is not open');
    const encoder = new TextEncoder();
    // Don't await — fire and forget for streaming performance
    this._writer.write(encoder.encode(data)).catch((e: unknown) => {
      this._errorCallbacks.dispatch(errorFromUnknownError(e));
    });
  }

  writeByte(byte: number): void {
    if (!this._isOpen || !this._writer) throw new Error('Port is not open');
    this._writer.write(new Uint8Array([byte])).catch((e: unknown) => {
      this._errorCallbacks.dispatch(errorFromUnknownError(e));
    });
  }

  /**
   * Awaitable critical write. Awaits the underlying writer.write() and
   * rethrows on failure (no swallowing). Use only for safety-critical paths
   * where the caller needs to know whether the write actually landed. T1-22.
   */
  async writeCritical(data: string): Promise<void> {
    if (!this._isOpen || !this._writer) throw new Error('Port is not open');
    const encoder = new TextEncoder();
    await this._writer.write(encoder.encode(data));
  }

  /**
   * Awaitable critical realtime-byte write (e.g. soft reset 0x18). Awaits the
   * underlying writer.write() and rethrows on failure. T1-22.
   */
  async writeByteCritical(byte: number): Promise<void> {
    if (!this._isOpen || !this._writer) throw new Error('Port is not open');
    await this._writer.write(new Uint8Array([byte]));
  }

  async writeLine(line: string): Promise<void> {
    await this.writeCritical(line.endsWith('\n') ? line : `${line}\n`);
  }

  async writeCriticalLine(line: string): Promise<void> {
    await this.writeCritical(line.endsWith('\n') ? line : `${line}\n`);
  }

  writeRealtimeByte(byte: number): void {
    this.writeByte(byte);
  }

  async writeCriticalRealtimeByte(byte: number): Promise<void> {
    await this.writeByteCritical(byte);
  }

  onLine(callback: (line: string) => void): Unsubscribe {
    return this.onData(callback);
  }

  onData(callback: (line: string) => void): Unsubscribe {
    return this._dataCallbacks.subscribe(callback);
  }

  onError(callback: (error: Error) => void): Unsubscribe {
    return this._errorCallbacks.subscribe(callback);
  }

  onClose(callback: () => void): Unsubscribe {
    return this._closeCallbacks.subscribe(callback);
  }

  // T2-31: async close. `isOpen` flips to false synchronously at entry
  // so existing `if (!port.isOpen)` guards fire immediately; the
  // returned promise resolves after the browser-level `port.close()`
  // (and best-effort `forget()`) actually completes. Pre-T2-31 the
  // browser-close ran un-awaited; a caller could believe the port was
  // fully closed while the browser was still releasing it, and rapid
  // reconnect could race the still-closing handle.
  async close(): Promise<void> {
    this._readLoopActive = false;
    this._isOpen = false;
    this._detachNavigatorDisconnectListener();

    const port = this._port;

    if (this._reader) {
      // cancel() may reject if reader is already released; swallow.
      try {
        await this._reader.cancel();
      } catch {
        /* ignore */
      }
      try {
        this._reader.releaseLock();
      } catch {
        /* ignore */
      }
      this._reader = null;
    }
    if (this._writer) {
      try {
        this._writer.releaseLock();
      } catch {
        /* ignore */
      }
      this._writer = null;
    }
    if (port) {
      // T3-48: stop calling `port.forget()` on every close. Pre-T3-48
      // every disconnect cycle revoked the persistent permission grant,
      // forcing the user to re-pick the device on every reconnect.
      // The persistent grant is the entire point of `getPorts()` /
      // `connectKnownPortOrPrompt` — keep it across normal close so
      // reconnects can reuse the previously-authorized port. Users who
      // explicitly want to revoke the grant call {@link forgetActiveDevice}
      // (live port) or the static {@link forgetKnownPorts} helper.
      try {
        await port.close();
      } catch {
        // close() failed — port likely already closed from the other
        // side. We deliberately do NOT call forget() here; revoking
        // the grant on a transient close failure would silently degrade
        // the user's "remember my device" UX.
      }
      this._port = null;
    }

    this._closeCallbacks.dispatch();
  }

  private _navigatorSerialEventTarget(): {
    addEventListener?: (type: 'disconnect', callback: (event: Event & { port?: SerialPort }) => void) => void;
    removeEventListener?: (type: 'disconnect', callback: (event: Event & { port?: SerialPort }) => void) => void;
  } | null {
    if (typeof navigator === 'undefined' || !('serial' in navigator)) return null;
    return (navigator as unknown as { serial?: unknown }).serial as {
      addEventListener?: (type: 'disconnect', callback: (event: Event & { port?: SerialPort }) => void) => void;
      removeEventListener?: (type: 'disconnect', callback: (event: Event & { port?: SerialPort }) => void) => void;
    } | null;
  }

  private _attachNavigatorDisconnectListener(port: SerialPort): void {
    // T3-49: WebSerial exposes a navigator-level disconnect event that
    // fires when the OS observes USB removal. Hooking it here feeds the
    // existing onClose path faster than waiting for read/write failure.
    this._detachNavigatorDisconnectListener();
    if (this._port !== port) return;
    const serial = this._navigatorSerialEventTarget();
    if (typeof serial?.addEventListener !== 'function') return;
    const handler = (event: Event & { port?: SerialPort }) => this._handleNavigatorDisconnect(event);
    this._navigatorDisconnectHandler = handler;
    serial.addEventListener('disconnect', handler);
  }

  private _detachNavigatorDisconnectListener(): void {
    const handler = this._navigatorDisconnectHandler;
    if (!handler) return;
    this._navigatorDisconnectHandler = null;
    const serial = this._navigatorSerialEventTarget();
    if (typeof serial?.removeEventListener === 'function') {
      serial.removeEventListener('disconnect', handler);
    }
  }

  private _handleNavigatorDisconnect(event: Event & { port?: SerialPort }): void {
    if (!this._port) return;
    const eventPort = event.port;
    if (eventPort && eventPort !== this._port) return;

    this._readLoopActive = false;
    this._isOpen = false;
    this._detachNavigatorDisconnectListener();

    const reader = this._reader;
    this._reader = null;
    if (reader) {
      void reader.cancel().catch(() => { /* ignore */ }).finally(() => {
        try { reader.releaseLock(); } catch { /* ignore */ }
      });
    }
    if (this._writer) {
      try {
        this._writer.releaseLock();
      } catch {
        /* ignore */
      }
      this._writer = null;
    }
    this._port = null;
    this._closeCallbacks.dispatch();
  }

  private async _startReadLoop(): Promise<void> {
    if (!this._reader) return;
    this._readLoopActive = true;

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (this._readLoopActive) {
        const { value, done } = await this._reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Split on newline and carriage return
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            this._dataCallbacks.dispatch(trimmed);
          }
        }
      }
    } catch (e: unknown) {
      if (this._readLoopActive) {
        this._errorCallbacks.dispatch(new Error(`Read error: ${messageFromUnknownError(e)}`));
      }
    }

    if (this._readLoopActive) {
      this._isOpen = false;
      this._closeCallbacks.dispatch();
    }
  }
}

/**
 * Read USB descriptor metadata from a `SerialPort`. Browsers that do
 * not implement `getInfo` return an empty fingerprint, which matches
 * any caller-supplied fingerprint (vendor/product undefined → match).
 */
function extractFingerprint(port: SerialPort): DeviceFingerprint {
  if (typeof port.getInfo !== 'function') return {};
  try {
    const info = port.getInfo();
    return {
      usbVendorId: info?.usbVendorId,
      usbProductId: info?.usbProductId,
    };
  } catch {
    return {};
  }
}

export function messageFromUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return String(error);
  } catch {
    return 'Unknown error';
  }
}

function errorFromUnknownError(error: unknown): Error {
  return error instanceof Error ? error : new Error(messageFromUnknownError(error));
}

async function applySerialSignals(
  port: SerialPort,
  serialSignals?: SerialOutputSignals,
): Promise<void> {
  if (!serialSignals || typeof port.setSignals !== 'function') return;
  await port.setSignals(serialSignals);
}

/**
 * `true` iff the port's USB descriptor matches every populated field
 * of the fingerprint. An undefined fingerprint field is wildcard.
 * Returns `false` when `getInfo` is not implemented and the
 * fingerprint requires a specific vendor/product id (we cannot
 * confirm a match without descriptors).
 */
function matchesFingerprint(port: SerialPort, fingerprint: DeviceFingerprint): boolean {
  if (typeof port.getInfo !== 'function') {
    // Browser cannot read descriptors. If the fingerprint is empty
    // (no vendor/product specified) we accept; otherwise we cannot
    // verify a match.
    return fingerprint.usbVendorId === undefined && fingerprint.usbProductId === undefined;
  }
  let info: SerialPortInfo;
  try {
    info = port.getInfo();
  } catch {
    return false;
  }
  if (fingerprint.usbVendorId !== undefined && info.usbVendorId !== fingerprint.usbVendorId) {
    return false;
  }
  if (fingerprint.usbProductId !== undefined && info.usbProductId !== fingerprint.usbProductId) {
    return false;
  }
  return true;
}
