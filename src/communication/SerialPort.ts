/**
 * === FILE: /src/communication/SerialPort.ts ===
 *
 * Purpose:    Abstract serial port interface. Decouples controller
 *             logic from hardware. In production, backed by Node.js
 *             `serialport` via Electron IPC. In tests, backed by a mock.
 *
 * Dependencies: None (interface-only)
 * Last updated: Phase 6, Step 21 — Serial communication
 */

// ─── SERIAL PORT INTERFACE ───────────────────────────────────────

export interface SerialPortLike {
  /** Write raw string data to the port. Appends newline if not present. */
  write(data: string): void;

  /** Write a single byte (for real-time commands like ?, !, ~). */
  writeByte(byte: number): void;

  /** Register callback for incoming lines (split by newline). */
  onData(callback: (line: string) => void): void;

  /** Register callback for errors. */
  onError(callback: (error: Error) => void): void;

  /** Register callback for port close/disconnect. */
  onClose(callback: () => void): void;

  /** Close the port. */
  close(): void;

  /** Whether the port is currently open. */
  readonly isOpen: boolean;
}

// ─── MOCK SERIAL PORT ────────────────────────────────────────────

/**
 * Mock serial port for testing. Simulates GRBL responses.
 *
 * When a line is written:
 *   - Stores it in a received queue
 *   - Calls the response generator to produce a reply
 *   - Delivers the reply to the onData callback (async, next tick)
 *
 * This allows tests to verify exact streaming behavior
 * without real hardware.
 */
export class MockSerialPort implements SerialPortLike {
  private _isOpen = false;
  private _dataCallback: ((line: string) => void) | null = null;
  private _errorCallback: ((error: Error) => void) | null = null;
  private _closeCallback: (() => void) | null = null;
  private _responseGenerator: (line: string) => string[];

  /** Lines received from the controller, in order. */
  readonly received: string[] = [];

  /** Lines sent back to the controller, in order. */
  readonly sent: string[] = [];

  constructor(responseGenerator?: (line: string) => string[]) {
    this._responseGenerator = responseGenerator || defaultGrblResponder;
  }

  get isOpen(): boolean {
    return this._isOpen;
  }

  /** Simulate opening the port. Sends GRBL welcome message. */
  open(): void {
    this._isOpen = true;
    // GRBL sends welcome message on connect
    this.injectResponse('Grbl 1.1h [\'$\' for help]');
  }

  write(data: string): void {
    if (!this._isOpen) throw new Error('Port is not open');
    const line = data.replace(/[\r\n]+$/, '');
    this.received.push(line);

    // Generate responses asynchronously (simulates serial delay)
    const responses = this._responseGenerator(line);
    for (const resp of responses) {
      this.injectResponse(resp);
    }
  }

  writeByte(byte: number): void {
    if (!this._isOpen) throw new Error('Port is not open');
    // Real-time commands: ? = status, ! = hold, ~ = resume
    if (byte === 0x3F) { // '?'
      this.injectResponse('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    }
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
    this._isOpen = false;
    this._closeCallback?.();
  }

  /** Inject a response line as if it came from the device. */
  injectResponse(line: string): void {
    this.sent.push(line);
    // Deliver asynchronously to match real serial behavior
    Promise.resolve().then(() => {
      this._dataCallback?.(line);
    });
  }

  /** Simulate a disconnect event. */
  simulateDisconnect(): void {
    this._isOpen = false;
    this._closeCallback?.();
  }

  /** Simulate an error. */
  simulateError(message: string): void {
    this._errorCallback?.(new Error(message));
  }
}

// ─── DEFAULT GRBL RESPONDER ──────────────────────────────────────

/**
 * Simulates GRBL's response behavior:
 * - G-code lines → 'ok'
 * - $$ → settings dump
 * - Empty lines → 'ok'
 * - Invalid lines → 'error:X'
 */
function defaultGrblResponder(line: string): string[] {
  if (line === '') return ['ok'];
  if (line.startsWith(';')) return []; // Comments — no response
  if (line.startsWith('$')) return ['ok']; // System commands
  if (line.startsWith('G') || line.startsWith('M') || line.startsWith('F') || line.startsWith('S')) {
    return ['ok'];
  }
  // Unknown command
  return ['error:20']; // Unsupported command
}
