/**
 * GRBL 1.1 controller with character-counting buffer management.
 * Pipelines G-code for maximum throughput — no stuttering.
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

const GRBL_BUFFER_SIZE = 127;
const STATUS_POLL_INTERVAL = 200;
const REALTIME_STATUS = 0x3F;
const REALTIME_HOLD = 0x21;
const REALTIME_RESUME = 0x7E;
const REALTIME_RESET = 0x18;

interface PendingLine {
  text: string;
  byteCount: number;
}

export class GrblController implements LaserController {
  readonly protocolName = 'GRBL 1.1';

  private _state: MachineState;
  private _port: SerialPortLike | null = null;
  private _isJobRunning = false;

  private _jobLines: string[] = [];
  private _queueIndex = 0;
  private _pending: PendingLine[] = [];
  private _bufferAvailable = GRBL_BUFFER_SIZE;
  private _linesAcknowledged = 0;
  private _jobStartTime = 0;
  private _stopOnError = true;

  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  private _stateListeners: Set<StateChangeCallback> = new Set();
  private _progressListeners: Set<ProgressCallback> = new Set();
  private _errorListeners: Set<ErrorCallback> = new Set();
  private _rawLineListeners: Set<RawLineCallback> = new Set();

  constructor() {
    this._state = {
      status: 'disconnected',
      position: { x: 0, y: 0, z: 0 },
      feedRate: 0,
      spindleSpeed: 0,
      alarmCode: null,
      errorCode: null,
    };
  }

  get state(): MachineState { return { ...this._state }; }
  get isJobRunning(): boolean { return this._isJobRunning; }

  // ─── LIFECYCLE ──────────────────────────────────────────────

  async connect(port: SerialPortLike): Promise<void> {
    if (this._port) throw new Error('Already connected. Disconnect first.');

    this._port = port;
    this._updateStatus('connecting');

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout — no GRBL welcome message'));
      }, 5000);

      let welcomeReceived = false;

      port.onData((line) => {
        this._emitRawLine(line, 'rx');

        if (!welcomeReceived && line.startsWith('Grbl')) {
          welcomeReceived = true;
          clearTimeout(timeout);
          this._updateStatus('idle');
          this._startStatusPolling();
          resolve();
          return;
        }

        if (welcomeReceived) {
          this._handleLine(line);
        }
      });

      port.onError((err) => {
        for (const cb of this._errorListeners) {
          cb(-1, `Serial error: ${err.message}`);
        }
      });

      port.onClose(() => {
        this._stopStatusPolling();
        this._abortJob();
        this._port = null;
        this._updateStatus('disconnected');
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

  // ─── JOB EXECUTION ──────────────────────────────────────────

  sendJob(lines: string[]): void {
    if (!this._port?.isOpen) throw new Error('Not connected');
    if (this._isJobRunning) throw new Error('Job already running');

    this._jobLines = lines.filter(l => l.trim().length > 0 && !l.trim().startsWith(';'));
    this._queueIndex = 0;
    this._pending = [];
    this._bufferAvailable = GRBL_BUFFER_SIZE;
    this._linesAcknowledged = 0;
    this._jobStartTime = Date.now();

    // No lines to stream — never set _isJobRunning or we never get 'ok' and manual sendCommand stays blocked forever
    if (this._jobLines.length === 0) {
      this._emitProgress();
      return;
    }

    this._isJobRunning = true;
    this._updateStatus('run');
    this._emitProgress();
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
    this._drainQueue();
  }

  stop(): void {
    this._sendRealtime(REALTIME_RESET);
    this._abortJob();
  }

  // ─── MANUAL CONTROL ─────────────────────────────────────────

  sendCommand(command: string): void {
    if (!this._port?.isOpen) throw new Error('Not connected');

    // Allow realtime commands during jobs (status query, feed hold, resume, soft reset)
    const isRealtimeCommand =
      command === '?' || command === '!' || command === '~' || command === '\x18';

    if (this._isJobRunning && !isRealtimeCommand) {
      throw new Error('Cannot send manual command while job is running');
    }

    if (typeof command !== 'string' || command.length === 0) {
      throw new Error('Invalid command: empty');
    }

    if (command.length > 127) {
      throw new Error('Command exceeds GRBL buffer size (127 bytes)');
    }

    if (/[\r\n]/.test(command)) {
      throw new Error('Multi-line commands not allowed');
    }

    this._writeLine(command);
  }

  requestStatusReport(): void {
    if (!this._port?.isOpen) return;
    this._sendRealtime(REALTIME_STATUS);
  }

  // ─── EVENTS ─────────────────────────────────────────────────

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

  // ─── LINE HANDLER ───────────────────────────────────────────

  private _handleLine(line: string): void {
    if (line === 'ok') {
      this._handleOk();
    } else if (line.startsWith('error:')) {
      this._handleError(line);
    } else if (line.startsWith('<') && line.endsWith('>')) {
      this._handleStatusReport(line);
    } else if (line.startsWith('ALARM:')) {
      this._handleAlarm(line);
    } else if (line.startsWith('Grbl')) {
      this._updateStatus('idle');
    }
  }

  private _handleOk(): void {
    if (this._pending.length === 0) return;

    const oldest = this._pending.shift()!;
    this._bufferAvailable += oldest.byteCount;
    this._linesAcknowledged++;
    this._emitProgress();

    if (this._isJobRunning &&
        this._queueIndex >= this._jobLines.length &&
        this._pending.length === 0) {
      this._completeJob();
      return;
    }

    this._drainQueue();
  }

  private _handleError(line: string): void {
    const code = parseInt(line.split(':')[1], 10) || 0;

    if (this._pending.length > 0) {
      const oldest = this._pending.shift()!;
      this._bufferAvailable += oldest.byteCount;
      this._linesAcknowledged++;

      for (const cb of this._errorListeners) {
        cb(code, `GRBL error ${code} on line: ${oldest.text}`);
      }
    }

    this._state.errorCode = code;
    this._emitProgress();

    // Stop streaming on error by default — safer for real machines
    if (this._stopOnError) {
      this._abortJob();
      this._updateStatus('idle');
      return;
    }

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

  // ─── STATUS REPORT PARSING ──────────────────────────────────

  private _handleStatusReport(raw: string): void {
    const content = raw.slice(1, -1);
    const parts = content.split('|');
    if (parts.length === 0) return;

    const stateStr = parts[0].toLowerCase();
    const statusMap: Record<string, MachineStatus> = {
      idle: 'idle', run: 'run', hold: 'hold',
      'hold:0': 'hold', 'hold:1': 'hold',
      alarm: 'alarm', home: 'homing', check: 'check',
    };
    const newStatus = statusMap[stateStr];
    if (newStatus && this._state.status !== 'disconnected' && this._state.status !== 'connecting') {
      this._state.status = newStatus;
    }

    let mPos: MachinePosition | null = null;
    let wPos: MachinePosition | null = null;

    for (let i = 1; i < parts.length; i++) {
      const colonIdx = parts[i].indexOf(':');
      if (colonIdx < 0) continue;
      const key = parts[i].slice(0, colonIdx);
      const value = parts[i].slice(colonIdx + 1);

      switch (key) {
        case 'MPos': {
          const coords = value.split(',').map(Number);
          if (coords.length >= 2) {
            mPos = { x: coords[0], y: coords[1], z: coords[2] || 0 };
          }
          break;
        }
        case 'WPos': {
          const coords = value.split(',').map(Number);
          if (coords.length >= 2) {
            wPos = { x: coords[0], y: coords[1], z: coords[2] || 0 };
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

    if (wPos) {
      this._state.position = wPos;
    } else if (mPos) {
      this._state.position = mPos;
    }

    for (const cb of this._stateListeners) {
      cb({ ...this._state });
    }
  }

  // ─── CHARACTER-COUNTING STREAMING ───────────────────────────

  /**
   * Send as many queued lines as the GRBL buffer can hold.
   * Each line costs (line.length + 1) bytes.
   * Don't send if it would overflow the 127-byte buffer.
   * On each 'ok', free the bytes for the oldest pending line.
   */
  private _drainQueue(): void {
    if (!this._port?.isOpen || !this._isJobRunning) return;
    if (this._state.status === 'hold') return;

    while (this._queueIndex < this._jobLines.length) {
      const line = this._jobLines[this._queueIndex];
      const byteCount = line.length + 1;

      if (byteCount > this._bufferAvailable) break;

      this._writeLine(line);
      this._pending.push({ text: line, byteCount });
      this._bufferAvailable -= byteCount;
      this._queueIndex++;
    }
  }

  // ─── JOB LIFECYCLE ──────────────────────────────────────────

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

  // ─── INTERNALS ──────────────────────────────────────────────

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

  // ─── STATUS POLLING ─────────────────────────────────────────

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
}
