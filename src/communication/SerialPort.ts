/**
 * Abstract serial port interface. Decouples controller
 * logic from hardware. In production, backed by Web Serial API.
 * In tests, backed by a mock.
 */

export interface SerialPortLike {
  write(data: string): void;
  writeByte(byte: number): void;
  onData(callback: (line: string) => void): void;
  onError(callback: (error: Error) => void): void;
  onClose(callback: () => void): void;
  close(): void;
  readonly isOpen: boolean;
}

/**
 * Mock serial port for testing. Simulates GRBL responses.
 */
export class MockSerialPort implements SerialPortLike {
  private _isOpen = false;
  private _dataCallback: ((line: string) => void) | null = null;
  private _errorCallback: ((error: Error) => void) | null = null;
  private _closeCallback: (() => void) | null = null;
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

  constructor(responseGenerator?: (line: string) => string[], bed?: { width: number; height: number }) {
    this._responseGenerator = responseGenerator ?? null;
    this._maxX = bed?.width ?? 10000;
    this._maxY = bed?.height ?? 10000;
  }

  get isOpen(): boolean { return this._isOpen; }

  open(): void {
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

  writeByte(byte: number): void {
    if (!this._isOpen) throw new Error('Port is not open');
    if (byte === 0x3F) {
      if (this._responseGenerator) {
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

  onData(callback: (line: string) => void): void { this._dataCallback = callback; }
  onError(callback: (error: Error) => void): void { this._errorCallback = callback; }
  onClose(callback: () => void): void { this._closeCallback = callback; }

  close(): void {
    this._isOpen = false;
    this._closeCallback?.();
  }

  injectResponse(line: string): void {
    this.sent.push(line);
    Promise.resolve().then(() => { this._dataCallback?.(line); });
  }

  simulateDisconnect(): void {
    this._isOpen = false;
    this._closeCallback?.();
  }

  simulateError(message: string): void {
    this._errorCallback?.(new Error(message));
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
