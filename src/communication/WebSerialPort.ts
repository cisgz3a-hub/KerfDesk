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

  private _dataCallback: ((line: string) => void) | null = null;
  private _errorCallback: ((error: Error) => void) | null = null;
  private _closeCallback: (() => void) | null = null;

  get isOpen(): boolean { return this._isOpen; }

  static isSupported(): boolean {
    if (typeof navigator === 'undefined') return false;
    return 'serial' in navigator;
  }

  async open(options?: TransportOpenOptions): Promise<void> {
    await this.requestAndOpen(options?.baudRate ?? 115200, options?.signal);
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
  async requestAndOpen(baudRate: number = 115200, signal?: AbortSignal): Promise<void> {
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
    } catch (e) {
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
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Failed to open serial port: ${msg}`);
    }
  }

  write(data: string): void {
    if (!this._isOpen || !this._writer) throw new Error('Port is not open');
    const encoder = new TextEncoder();
    // Don't await — fire and forget for streaming performance
    this._writer.write(encoder.encode(data)).catch((e: Error) => {
      this._errorCallback?.(e);
    });
  }

  writeByte(byte: number): void {
    if (!this._isOpen || !this._writer) throw new Error('Port is not open');
    this._writer.write(new Uint8Array([byte])).catch((e: Error) => {
      this._errorCallback?.(e);
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
    this._dataCallback = callback;
    return () => {
      if (this._dataCallback === callback) this._dataCallback = null;
    };
  }

  onError(callback: (error: Error) => void): Unsubscribe {
    this._errorCallback = callback;
    return () => {
      if (this._errorCallback === callback) this._errorCallback = null;
    };
  }

  onClose(callback: () => void): Unsubscribe {
    this._closeCallback = callback;
    return () => {
      if (this._closeCallback === callback) this._closeCallback = null;
    };
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
      // Chain: close the handle, THEN revoke the permission grant.
      // forget() is best-effort — browsers may reject it if the
      // permission was granted by administrator policy, which we
      // ignore. Not all browsers support forget() (Chrome 103+),
      // so feature-detect. Electron ships Chromium new enough to
      // have it, but guard for safety.
      try {
        await port.close();
      } catch {
        // close() failed — port likely already closed from the
        // other side. Still try forget() to release the grant.
      }
      const portWithForget = port as unknown as { forget?: () => Promise<void> };
      if (typeof portWithForget.forget === 'function') {
        try {
          await portWithForget.forget();
        } catch {
          /* forget failed — e.g. policy-granted permission */
        }
      }
      this._port = null;
    }

    this._closeCallback?.();
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
    this._closeCallback?.();
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
            this._dataCallback?.(trimmed);
          }
        }
      }
    } catch (e: any) {
      if (this._readLoopActive) {
        this._errorCallback?.(new Error(`Read error: ${e.message}`));
      }
    }

    if (this._readLoopActive) {
      this._isOpen = false;
      this._closeCallback?.();
    }
  }
}
