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
  private _responseGenerator: (line: string) => string[];

  readonly received: string[] = [];
  readonly sent: string[] = [];

  constructor(responseGenerator?: (line: string) => string[]) {
    this._responseGenerator = responseGenerator || defaultGrblResponder;
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
    const responses = this._responseGenerator(line);
    for (const resp of responses) {
      this.injectResponse(resp);
    }
  }

  writeByte(byte: number): void {
    if (!this._isOpen) throw new Error('Port is not open');
    if (byte === 0x3F) {
      this.injectResponse('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
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
}

function defaultGrblResponder(line: string): string[] {
  if (line === '') return ['ok'];
  if (line.startsWith(';')) return [];
  if (line.startsWith('$')) return ['ok'];
  if (line.startsWith('G') || line.startsWith('M') || line.startsWith('F') || line.startsWith('S')) {
    return ['ok'];
  }
  return ['error:20'];
}
