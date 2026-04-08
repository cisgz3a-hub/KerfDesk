/**
 * === FILE: /src/controllers/grbl/GrblController.ts ===
 *
 * Purpose:    GRBL 1.1 controller implementation. Manages the full
 *             lifecycle of machine communication:
 *
 *             1. Connection and firmware detection
 *             2. State machine (idle/run/hold/alarm)
 *             3. Character-counting buffer management (127 bytes)
 *             4. Line-by-line G-code streaming with backpressure
 *             5. Status report parsing (<State|MPos:...|FS:...>)
 *             6. Real-time commands (?, !, ~)
 *             7. Progress tracking
 *             8. Error handling with line-level attribution
 *
 * Protocol:   GRBL 1.1 over serial at 115200 baud.
 *             Commands terminated by newline (\n).
 *             Responses: 'ok', 'error:N', '<...>' status, '[MSG:...]'
 *             Real-time commands: ? (status), ! (hold), ~ (resume),
 *                                 0x18 (soft reset) — bypass buffer.
 *
 * Dependencies:
 *   - /src/controllers/ControllerInterface.ts
 *   - /src/communication/SerialPort.ts
 *   - /src/core/output/Output.ts
 * Last updated: Phase 6, Step 22 — GRBL Controller
 */

import {
  type LaserController,
  type MachineState,
  type MachineStatus,
  type MachinePosition,
  type JobProgress,
  type StateChangeCallback,
  type ProgressCallback,
  type ErrorCallback,
  type RawLineCallback,
  type Unsubscribe,
} from '../ControllerInterface';
import { type SerialPortLike } from '../../communication/SerialPort';
import { type Output } from '../../core/output/Output';

// ─── CONSTANTS ───────────────────────────────────────────────────

const GRBL_BUFFER_SIZE = 127;    // bytes
const STATUS_POLL_INTERVAL = 200; // ms (5 Hz)
const REALTIME_STATUS = 0x3F;    // '?'
const REALTIME_HOLD = 0x21;      // '!'
const REALTIME_RESUME = 0x7E;    // '~'
const REALTIME_RESET = 0x18;     // Ctrl+X

// ─── GRBL CONTROLLER ─────────────────────────────────────────────

export class GrblController implements LaserController {
  readonly protocolName = 'GRBL 1.1';

  // ─── State ───
  private _state: MachineState;
  private _port: SerialPortLike | null = null;
  private _isJobRunning = false;

  // ─── Streaming ───
  private _jobLines: string[] = [];
  private _queueIndex = 0;           // Next line to send
  private _pending: PendingLine[] = []; // Sent but not yet acked
  private _bufferAvailable = GRBL_BUFFER_SIZE;
  private _linesAcknowledged = 0;
  private _jobStartTime = 0;

  // ─── Status polling ───
  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  // ─── Event subscribers ───
  private _stateListeners: Set<StateChangeCallback> = new Set();
  private _progressListeners: Set<ProgressCallback> = new Set();
  private _errorListeners: Set<ErrorCallback> = new Set();
  private _rawLineListeners: Set<RawLineCallback> = new Set();

  constructor() {
    this._state = createDefaultState();
  }

  // ─── PUBLIC PROPERTIES ─────────────────────────────────────────

  get state(): MachineState {
    return { ...this._state };
  }

  get isJobRunning(): boolean {
    return this._isJobRunning;
  }

  // ─── LIFECYCLE ─────────────────────────────────────────────────

  async connect(port: SerialPortLike): Promise<void> {
    if (this._port) {
      throw new Error('Already connected. Disconnect first.');
    }

    this._port = port;
    this._updateStatus('connecting');

    // Register serial event handlers
    port.onData((line) => this._handleLine(line));
    port.onError((err) => this._handlePortError(err));
    port.onClose(() => this._handlePortClose());

    // Wait for GRBL welcome message
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout — no GRBL welcome message'));
      }, 5000);

      const originalHandler = this._handleLine.bind(this);
      const welcomeHandler = (line: string) => {
        if (line.startsWith('Grbl')) {
          clearTimeout(timeout);
          this._updateStatus('idle');
          this._startStatusPolling();
          resolve();
        }
      };

      // Temporarily intercept to detect welcome
      port.onData((line) => {
        this._emitRawLine(line, 'rx');
        welcomeHandler(line);
        // After welcome, all lines go through normal handler
        if (this._state.status !== 'connecting') {
          port.onData((l) => this._handleLine(l));
        }
      });
    });
  }

  async disconnect(): Promise<void> {
    this._stopStatusPolling();
    this._abortJob();

    if (this._port) {
      this._port.close();
      this._port = null;
    }

    this._updateStatus('disconnected');
  }

  // ─── JOB EXECUTION ─────────────────────────────────────────────

  sendJob(output: Output): void {
    if (!this._port?.isOpen) {
      throw new Error('Not connected');
    }
    if (this._isJobRunning) {
      throw new Error('Job already running. Stop first.');
    }
    if (!output.text) {
      throw new Error('Output has no text content');
    }

    // Parse G-code into lines, filter empties and pure comments
    this._jobLines = output.text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith(';'));

    this._queueIndex = 0;
    this._pending = [];
    this._bufferAvailable = GRBL_BUFFER_SIZE;
    this._linesAcknowledged = 0;
    this._isJobRunning = true;
    this._jobStartTime = Date.now();

    this._updateStatus('run');
    this._emitProgress();

    // Start streaming
    this._drainQueue();
  }

  pause(): void {
    if (!this._isJobRunning) return;
    this._sendRealtime(REALTIME_HOLD);
    this._updateStatus('hold');
  }

  resume(): void {
    if (this._state.status !== 'hold') return;
    this._sendRealtime(REALTIME_RESUME);
    this._updateStatus('run');
  }

  stop(): void {
    this._sendRealtime(REALTIME_RESET);
    this._abortJob();
    // GRBL will send welcome message after reset → triggers idle state
  }

  // ─── MANUAL CONTROL ────────────────────────────────────────────

  sendCommand(command: string): void {
    if (!this._port?.isOpen) throw new Error('Not connected');
    this._writeLine(command);
  }

  requestStatusReport(): void {
    if (!this._port?.isOpen) return;
    this._sendRealtime(REALTIME_STATUS);
  }

  // ─── EVENTS ────────────────────────────────────────────────────

  onStateChange(callback: StateChangeCallback): Unsubscribe {
    this._stateListeners.add(callback);
    return () => this._stateListeners.delete(callback);
  }

  onProgress(callback: ProgressCallback): Unsubscribe {
    this._progressListeners.add(callback);
    return () => this._progressListeners.delete(callback);
  }

  onError(callback: ErrorCallback): Unsubscribe {
    this._errorListeners.add(callback);
    return () => this._errorListeners.delete(callback);
  }

  onRawLine(callback: RawLineCallback): Unsubscribe {
    this._rawLineListeners.add(callback);
    return () => this._rawLineListeners.delete(callback);
  }

  // ─── SERIAL DATA HANDLER ───────────────────────────────────────

  private _handleLine(line: string): void {
    this._emitRawLine(line, 'rx');

    if (line === 'ok') {
      this._handleOk();
    } else if (line.startsWith('error:')) {
      this._handleError(line);
    } else if (line.startsWith('<') && line.endsWith('>')) {
      this._handleStatusReport(line);
    } else if (line.startsWith('ALARM:')) {
      this._handleAlarm(line);
    } else if (line.startsWith('Grbl')) {
      // Welcome message after reset
      this._updateStatus('idle');
    }
    // [MSG:...] and other info lines are logged but not acted on
  }

  // ─── RESPONSE HANDLERS ─────────────────────────────────────────

  private _handleOk(): void {
    if (this._pending.length === 0) return;

    // Free buffer space for the oldest pending line
    const oldest = this._pending.shift()!;
    this._bufferAvailable += oldest.byteCount;
    this._linesAcknowledged++;

    this._emitProgress();

    // Check if job is complete
    if (this._isJobRunning &&
        this._queueIndex >= this._jobLines.length &&
        this._pending.length === 0) {
      this._completeJob();
      return;
    }

    // Try to send more lines
    this._drainQueue();
  }

  private _handleError(line: string): void {
    const code = parseInt(line.split(':')[1], 10) || 0;

    // Error still counts as acknowledgment (frees buffer)
    if (this._pending.length > 0) {
      const oldest = this._pending.shift()!;
      this._bufferAvailable += oldest.byteCount;
      this._linesAcknowledged++;

      // Emit error with the line that caused it
      for (const cb of this._errorListeners) {
        cb(code, `GRBL error ${code} on line: ${oldest.text}`);
      }
    }

    this._state.errorCode = code;
    this._emitProgress();

    // Continue streaming — single errors don't stop the job
    this._drainQueue();
  }

  private _handleAlarm(line: string): void {
    const code = parseInt(line.split(':')[1], 10) || 0;
    this._state.alarmCode = code;
    this._updateStatus('alarm');
    this._abortJob();

    for (const cb of this._errorListeners) {
      cb(code, `ALARM:${code} — machine halted`);
    }
  }

  // ─── STATUS REPORT PARSING ─────────────────────────────────────

  /**
   * Parse GRBL status report:
   * <State|MPos:X,Y,Z|FS:F,S|WCO:X,Y,Z|Ov:F,R,S>
   *
   * Not all fields appear in every report.
   * State is always first. Other fields are pipe-separated key:value.
   */
  private _handleStatusReport(raw: string): void {
    // Strip < and >
    const content = raw.slice(1, -1);
    const parts = content.split('|');

    if (parts.length === 0) return;

    // First part is always the state
    const stateStr = parts[0].toLowerCase();
    const statusMap: Record<string, MachineStatus> = {
      idle: 'idle', run: 'run', hold: 'hold',
      'hold:0': 'hold', 'hold:1': 'hold',
      alarm: 'alarm', home: 'homing', check: 'check',
    };
    const newStatus = statusMap[stateStr];
    if (newStatus && newStatus !== this._state.status) {
      // Only update from status report if not overriding manually
      if (this._state.status !== 'disconnected' && this._state.status !== 'connecting') {
        this._state.status = newStatus;
      }
    }

    // Parse remaining fields
    for (let i = 1; i < parts.length; i++) {
      const [key, value] = splitFirst(parts[i], ':');
      if (!value) continue;

      switch (key) {
        case 'MPos': {
          const coords = value.split(',').map(Number);
          if (coords.length >= 2) {
            this._state.position = {
              x: coords[0],
              y: coords[1],
              z: coords[2] || 0,
            };
          }
          break;
        }
        case 'WPos': {
          // Work position — use as-is (offset already applied by GRBL)
          const coords = value.split(',').map(Number);
          if (coords.length >= 2) {
            this._state.position = {
              x: coords[0],
              y: coords[1],
              z: coords[2] || 0,
            };
          }
          break;
        }
        case 'FS': {
          const [feed, spindle] = value.split(',').map(Number);
          this._state.feedRate = feed || 0;
          this._state.spindleSpeed = spindle || 0;
          break;
        }
        case 'F': {
          this._state.feedRate = Number(value) || 0;
          break;
        }
      }
    }

    // Notify listeners
    for (const cb of this._stateListeners) {
      cb({ ...this._state });
    }
  }

  // ─── CHARACTER-COUNTING STREAMING ──────────────────────────────

  /**
   * Send as many queued lines as the buffer can hold.
   *
   * Character-counting protocol:
   * - Each line costs (line.length + 1) bytes (+1 for newline)
   * - Don't send if it would overflow GRBL's 127-byte buffer
   * - On each 'ok', free the bytes for the oldest pending line
   */
  private _drainQueue(): void {
    if (!this._port?.isOpen || !this._isJobRunning) return;
    if (this._state.status === 'hold') return;

    while (this._queueIndex < this._jobLines.length) {
      const line = this._jobLines[this._queueIndex];
      const byteCount = line.length + 1; // +1 for newline

      // Would this line overflow the buffer?
      if (byteCount > this._bufferAvailable) {
        break; // Wait for an 'ok' to free space
      }

      // Send the line
      this._writeLine(line);
      this._pending.push({ text: line, byteCount });
      this._bufferAvailable -= byteCount;
      this._queueIndex++;
    }
  }

  // ─── JOB LIFECYCLE ─────────────────────────────────────────────

  private _completeJob(): void {
    this._isJobRunning = false;
    this._updateStatus('idle');
    this._emitProgress();
  }

  private _abortJob(): void {
    this._isJobRunning = false;
    this._jobLines = [];
    this._queueIndex = 0;
    this._pending = [];
    this._bufferAvailable = GRBL_BUFFER_SIZE;
  }

  // ─── PORT EVENTS ───────────────────────────────────────────────

  private _handlePortError(err: Error): void {
    for (const cb of this._errorListeners) {
      cb(-1, `Serial error: ${err.message}`);
    }
  }

  private _handlePortClose(): void {
    this._stopStatusPolling();
    this._abortJob();
    this._port = null;
    this._updateStatus('disconnected');
  }

  // ─── STATUS POLLING ────────────────────────────────────────────

  private _startStatusPolling(): void {
    this._stopStatusPolling();
    this._pollTimer = setInterval(() => {
      this.requestStatusReport();
    }, STATUS_POLL_INTERVAL);
  }

  private _stopStatusPolling(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  // ─── INTERNAL HELPERS ──────────────────────────────────────────

  private _writeLine(line: string): void {
    if (!this._port?.isOpen) return;
    this._port.write(line + '\n');
    this._emitRawLine(line, 'tx');
  }

  private _sendRealtime(byte: number): void {
    if (!this._port?.isOpen) return;
    this._port.writeByte(byte);
  }

  private _updateStatus(status: MachineStatus): void {
    if (this._state.status === status) return;
    this._state.status = status;
    for (const cb of this._stateListeners) {
      cb({ ...this._state });
    }
  }

  private _emitProgress(): void {
    if (!this._isJobRunning && this._linesAcknowledged === 0) return;

    const total = this._jobLines.length;
    const progress: JobProgress = {
      linesSent: this._queueIndex,
      linesAcknowledged: this._linesAcknowledged,
      totalLines: total,
      percentComplete: total > 0 ? (this._linesAcknowledged / total) * 100 : 0,
      elapsedMs: Date.now() - this._jobStartTime,
      bufferFill: GRBL_BUFFER_SIZE - this._bufferAvailable,
    };

    for (const cb of this._progressListeners) {
      cb(progress);
    }
  }

  private _emitRawLine(line: string, direction: 'tx' | 'rx'): void {
    for (const cb of this._rawLineListeners) {
      cb(line, direction);
    }
  }
}

// ─── INTERNAL TYPES ──────────────────────────────────────────────

interface PendingLine {
  text: string;
  byteCount: number;
}

// ─── HELPERS ─────────────────────────────────────────────────────

function createDefaultState(): MachineState {
  return {
    status: 'disconnected',
    position: { x: 0, y: 0, z: 0 },
    feedRate: 0,
    spindleSpeed: 0,
    alarmCode: null,
    errorCode: null,
  };
}

function splitFirst(str: string, sep: string): [string, string | undefined] {
  const idx = str.indexOf(sep);
  if (idx < 0) return [str, undefined];
  return [str.slice(0, idx), str.slice(idx + 1)];
}
