/**
 * Abstract serial port interface. Decouples controller
 * logic from hardware. In production, backed by Web Serial API.
 * In tests, backed by a mock.
 */

import {
  LINE_TRANSPORT_CAPABILITIES,
  type TransportCapabilities,
  type TransportKind,
  type TransportOpenOptions,
  type Unsubscribe,
} from '../transports/Transport';
import { SubscriptionSet } from './TransportSubscription';

export interface SerialPortLike {
  write(data: string): void;
  writeByte(byte: number): void;
  /**
   * Awaitable critical write. Resolves only after the underlying transport has
   * accepted the bytes (or, for mocks, after the mock has processed the line).
   * Rejects on transport failure (USB suspend, cable glitch, browser serial
   * fault, OS-level error). Use for safety-critical paths (M5 laser-off, soft
   * reset) where the caller must know whether the write actually landed.
   * T1-22.
   */
  writeCritical(data: string): Promise<void>;
  /**
   * Awaitable critical realtime byte (e.g. soft reset 0x18, feed-hold 0x21).
   * Same failure semantics as {@link writeCritical}. T1-22.
   */
  writeByteCritical(byte: number): Promise<void>;
  onData(callback: (line: string) => void): void;
  onError(callback: (error: Error) => void): void;
  onClose(callback: () => void): void;
  /**
   * T2-31: close the underlying transport. Returns a promise that resolves
   * after the browser / OS has actually released the port. Pre-T2-31 this
   * was sync — `WebSerialPort.close` set `isOpen = false` synchronously
   * but the underlying `port.close().then(...)` ran un-awaited, so a
   * caller could believe the port was fully closed while the browser
   * was still releasing it; rapid reconnect could race the still-closing
   * handle. Now `close()` resolves only after the browser-level close
   * completes (and `forget()` if available). `isOpen` flips to `false`
   * synchronously at entry so the new contract is back-compat: any
   * `if (!port.isOpen)` guard fires immediately, awaiting close is
   * optional but recommended for reconnect safety.
   *
   * Failure modes: rejects when the underlying browser close throws
   * something not caught by the existing `forget` fallback. Callers in
   * cleanup paths (connect-failure rollback, disconnect) should chain
   * `.catch(() => {})` if they don't want to surface the error.
   */
  close(): Promise<void>;
  readonly isOpen: boolean;
}

/**
 * Mock serial port for testing. Simulates GRBL responses.
 */
export class MockSerialPort implements SerialPortLike {
  readonly kind = 'mock-serial';
  readonly capabilities = LINE_TRANSPORT_CAPABILITIES;

  private _isOpen = false;
  private readonly _dataCallbacks = new SubscriptionSet<[line: string]>();
  private readonly _errorCallbacks = new SubscriptionSet<[error: Error]>();
  private readonly _closeCallbacks = new SubscriptionSet<[]>();
  private _responseGenerator: ((line: string) => string[]) | null;

  /** Last F feed rate (mm/min) from G-code stream; used when a move line has no F */
  private _lastFeedRate = 3000;
  /** Serialize delayed `ok` responses so order matches GRBL buffer drain */
  private _pendingOkChain: Promise<void> = Promise.resolve();

  /** Simulated machine position (mm), used when no custom responseGenerator is set */
  private _simPosX = 0;
  private _simPosY = 0;
  /** Work coordinate offset: MPos = W + offset → WPos = MPos - offset */
  private _workOffsetX = 0;
  private _workOffsetY = 0;
  /** G-code modal: true = absolute work coordinates on G0/G1 */
  private _modalG90 = true;
  private readonly _maxX: number;
  private readonly _maxY: number;

  readonly received: string[] = [];
  readonly sent: string[] = [];
  /** Bytes sent via writeByte (realtime GRBL commands). */
  readonly realtimeBytes: number[] = [];

  constructor(responseGenerator?: (line: string) => string[], bed?: { width: number; height: number }) {
    this._responseGenerator = responseGenerator ?? null;
    this._maxX = bed?.width ?? 10000;
    this._maxY = bed?.height ?? 10000;
  }

  get isOpen(): boolean { return this._isOpen; }

  async open(_options?: TransportOpenOptions): Promise<void> {
    this._isOpen = true;
    this.injectResponse("Grbl 1.1h ['$' for help]");
  }

  write(data: string): void {
    if (!this._isOpen) throw new Error('Port is not open');
    const line = data.replace(/[\r\n]+$/, '');
    this.received.push(line);
    if (this._responseGenerator) {
      const responses = this._responseGenerator(line);
      for (const resp of responses) {
        this.injectResponse(resp);
      }
      return;
    }
    const responses = this._defaultHandleLine(line);
    if (responses === null) return;
    for (const resp of responses) {
      this.injectResponse(resp);
    }
  }

  /**
   * When set, a realtime `?` (0x3F) injects this line instead of the default
   * `<Idle|...>` (used by tests to simulate alarm/run/hold status reports).
   */
  nextStatusQueryResponse: string | null = null;
  /**
   * When true, a `?` is recorded in `realtimeBytes` but no status line is
   * injected (timeout path in fresh-status preflight tests).
   */
  blockStatusQueryResponse = false;

  writeByte(byte: number): void {
    if (!this._isOpen) throw new Error('Port is not open');
    this.realtimeBytes.push(byte);
    if (byte === 0x3F) {
      if (this.blockStatusQueryResponse) return;
      if (this.nextStatusQueryResponse != null) {
        this.injectResponse(this.nextStatusQueryResponse);
      } else if (this._responseGenerator) {
        this.injectResponse('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
      } else {
        const wx = this._simPosX - this._workOffsetX;
        const wy = this._simPosY - this._workOffsetY;
        this.injectResponse(
          `<Idle|MPos:${this._simPosX.toFixed(3)},${this._simPosY.toFixed(3)},0.000|WPos:${wx.toFixed(3)},${wy.toFixed(3)},0.000|FS:0,0>`,
        );
      }
    }
  }

  /**
   * Test-only: when true, the next {@link writeCritical} or
   * {@link writeByteCritical} call rejects with a simulated transport error,
   * then the flag clears. Used by safety-write tests. T1-22.
   */
  failNextCriticalWrite = false;
  /**
   * Test-only: when set, all critical writes reject. Use when a test wants the
   * fallback to also fail (e.g. "both M5 and soft-reset failed"). T1-22.
   */
  failAllCriticalWrites = false;

  async writeCritical(data: string): Promise<void> {
    if (this.failAllCriticalWrites || this.failNextCriticalWrite) {
      this.failNextCriticalWrite = false;
      throw new Error('Simulated transport failure (writeCritical)');
    }
    // Reuse the same line-handling path as `write` so simulated `ok` responses
    // continue to fire and existing test infrastructure works unchanged.
    this.write(data);
  }

  async writeByteCritical(byte: number): Promise<void> {
    if (this.failAllCriticalWrites || this.failNextCriticalWrite) {
      this.failNextCriticalWrite = false;
      throw new Error('Simulated transport failure (writeByteCritical)');
    }
    this.writeByte(byte);
  }

  async writeLine(line: string): Promise<void> {
    this.write(line.endsWith('\n') ? line : `${line}\n`);
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

  // T2-31: async close. The mock has nothing to await — the in-memory
  // state flips synchronously and the close callback fires immediately,
  // matching the WebSerialPort.close shape so tests exercising both
  // implementations see the same await-then-isOpen-false guarantee.
  async close(): Promise<void> {
    this._isOpen = false;
    this._closeCallbacks.dispatch();
  }

  injectResponse(line: string): void {
    this.sent.push(line);
    Promise.resolve().then(() => { this._dataCallbacks.dispatch(line); });
  }

  simulateDisconnect(): void {
    this._isOpen = false;
    this._closeCallbacks.dispatch();
  }

  simulateError(message: string): void {
    this._errorCallbacks.dispatch(new Error(message));
  }

  /** Delay `ok` until after simulated move time; keeps oks ordered like real GRBL */
  private _scheduleDelayedOk(delayMs: number, apply: () => void): void {
    this._pendingOkChain = this._pendingOkChain.then(
      () =>
        new Promise<void>(resolve => {
          setTimeout(() => {
            try {
              apply();
              this.injectResponse('ok');
            } finally {
              resolve();
            }
          }, delayMs);
        }),
    );
  }

  private _defaultHandleLine(line: string): string[] | null {
    if (line === '') return ['ok'];
    if (line.startsWith(';')) return [];

    if (line === '$$') {
      return [
        '$10=0',
        '$22=0',
        '$23=0',
        '$32=0',
        '$30=1000.000',
        '$110=10000.000',
        '$111=10000.000',
        '$120=10.000',
        '$121=10.000',
        '$130=200.000',
        '$131=200.000',
        'ok',
      ];
    }
    if (line === '$#') {
      return [
        `[G54:${this._workOffsetX.toFixed(3)},${this._workOffsetY.toFixed(3)},0.000]`,
        '[G55:0.000,0.000,0.000]',
        'ok',
      ];
    }

    if (line.startsWith('$J=')) {
      const upper = line.toUpperCase();
      const xMatch = line.match(/[Xx]([0-9.-]+)/);
      const yMatch = line.match(/[Yy]([0-9.-]+)/);
      const isIncremental = upper.includes('G91');
      if (isIncremental) {
        if (xMatch) this._simPosX += parseFloat(xMatch[1]);
        if (yMatch) this._simPosY += parseFloat(yMatch[1]);
      } else {
        if (xMatch) this._simPosX = parseFloat(xMatch[1]) + this._workOffsetX;
        if (yMatch) this._simPosY = parseFloat(yMatch[1]) + this._workOffsetY;
      }
      this._simPosX = Math.max(0, Math.min(this._maxX, this._simPosX));
      this._simPosY = Math.max(0, Math.min(this._maxY, this._simPosY));
      return ['ok'];
    }

    if (line.startsWith('$')) return ['ok'];

    const u = line.toUpperCase();
    if (u.includes('G10') && u.includes('L20')) {
      const xm = line.match(/[Xx]([0-9.-]+)/);
      const ym = line.match(/[Yy]([0-9.-]+)/);
      if (xm) this._workOffsetX = this._simPosX - parseFloat(xm[1]);
      if (ym) this._workOffsetY = this._simPosY - parseFloat(ym[1]);
      return ['ok'];
    }

    // G0/G1: work coordinates when absolute; MPos = W + work offset — delay ok like real execution
    if (/\bG0\b|\bG00\b|\bG1\b|\bG01\b/.test(u)) {
      const fMatch = line.match(/[Ff]([0-9.]+)/);
      if (fMatch) this._lastFeedRate = parseFloat(fMatch[1]);

      const xMatch = line.match(/[Xx]([0-9.-]+)/);
      const yMatch = line.match(/[Yy]([0-9.-]+)/);
      const hadG90 = /\bG90\b/.test(u);
      const hadG91 = /\bG91\b/.test(u);
      let incremental: boolean;
      if (hadG91) incremental = true;
      else if (hadG90) incremental = false;
      else incremental = !this._modalG90;

      let newX = this._simPosX;
      let newY = this._simPosY;
      if (incremental) {
        if (xMatch) newX += parseFloat(xMatch[1]);
        if (yMatch) newY += parseFloat(yMatch[1]);
      } else {
        if (xMatch) newX = parseFloat(xMatch[1]) + this._workOffsetX;
        if (yMatch) newY = parseFloat(yMatch[1]) + this._workOffsetY;
      }
      newX = Math.max(0, Math.min(this._maxX, newX));
      newY = Math.max(0, Math.min(this._maxY, newY));

      if (hadG91) this._modalG90 = false;
      if (hadG90) this._modalG90 = true;

      const oldX = this._simPosX;
      const oldY = this._simPosY;
      const dx = newX - oldX;
      const dy = newY - oldY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const feedRate = Math.max(1, this._lastFeedRate);
      const moveTimeMs = (distance / feedRate) * 60000;
      const SIMULATOR_SPEED = 10;
      const delayMs = Math.max(1, Math.min(5000, moveTimeMs / SIMULATOR_SPEED));

      this._scheduleDelayedOk(delayMs, () => {
        this._simPosX = newX;
        this._simPosY = newY;
      });
      return null;
    }

    // G90 / G91 without a move (e.g. job header)
    if (!/\bG0\b|\bG00\b|\bG1\b|\bG01\b/.test(u)) {
      if (/\bG90\b/.test(u)) this._modalG90 = true;
      if (/\bG91\b/.test(u)) this._modalG90 = false;
    }

    if (line.startsWith('G') || line.startsWith('M') || line.startsWith('F') || line.startsWith('S')) {
      return ['ok'];
    }

    return ['error:20'];
  }
}
