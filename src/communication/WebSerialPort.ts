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

  onData(callback: (line: string) => void): void {
    this._dataCallback = callback;
  }

  onError(callback: (error: Error) => void): void {
    this._errorCallback = callback;
  }

  onClose(callback: () => void): void {
    this._closeCallback = callback;
  }

  close(): void {
    this._readLoopActive = false;
    this._isOpen = false;

    const port = this._port;

    try {
      if (this._reader) {
        this._reader.cancel().catch(() => {});
        this._reader.releaseLock();
        this._reader = null;
      }
      if (this._writer) {
        this._writer.releaseLock();
        this._writer = null;
      }
      if (port) {
        // Chain: close the handle, THEN revoke the permission grant.
        // forget() is best-effort — browsers may reject it if the
        // permission was granted by administrator policy, which we
        // ignore. Not all browsers support forget() (Chrome 103+),
        // so feature-detect. Electron ships Chromium new enough to
        // have it, but guard for safety.
        port
          .close()
          .then(() => {
            if (typeof (port as any).forget === 'function') {
              return (port as any).forget().catch(() => {
                /* forget failed — e.g. policy-granted permission */
              });
            }
          })
          .catch(() => {
            // close() failed — port likely already closed from the
            // other side. Still try forget() to release the grant.
            if (typeof (port as any).forget === 'function') {
              (port as any).forget().catch(() => {
                /* ignore */
              });
            }
          });
        this._port = null;
      }
    } catch {
      // Port may already be closed
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
