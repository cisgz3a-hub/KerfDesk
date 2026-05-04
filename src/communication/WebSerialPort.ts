/**
 * Web Serial API adapter that implements SerialPortLike.
 * Works in Electron's Chromium and Chrome browsers.
 * No native Node.js modules required.
 */

import { type SerialPortLike } from './SerialPort';

export class WebSerialPort implements SerialPortLike {
  private _port: SerialPort | null = null;
  private _reader: ReadableStreamDefaultReader | null = null;
  private _writer: WritableStreamDefaultWriter | null = null;
  private _isOpen = false;
  private _readLoopActive = false;

  private _dataCallback: ((line: string) => void) | null = null;
  private _errorCallback: ((error: Error) => void) | null = null;
  private _closeCallback: (() => void) | null = null;

  get isOpen(): boolean { return this._isOpen; }

  static isSupported(): boolean {
    if (typeof navigator === 'undefined') return false;
    return 'serial' in navigator;
  }

  /** Prompt user to select a serial port */
  async requestAndOpen(baudRate: number = 115200): Promise<void> {
    try {
      this._port = await (navigator as any).serial.requestPort();
      await this._port!.open({ baudRate });

      this._writer = this._port!.writable?.getWriter() || null;
      this._reader = this._port!.readable?.getReader() || null;
      this._isOpen = true;

      this._startReadLoop();
    } catch (e: any) {
      this._isOpen = false;
      throw new Error(`Failed to open serial port: ${e.message}`);
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

  onData(callback: (line: string) => void): void {
    this._dataCallback = callback;
  }

  onError(callback: (error: Error) => void): void {
    this._errorCallback = callback;
  }

  onClose(callback: () => void): void {
    this._closeCallback = callback;
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
