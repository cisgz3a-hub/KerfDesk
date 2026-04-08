/**
 * === FILE: /src/controllers/ControllerInterface.ts ===
 *
 * Purpose:    Abstract interface that all laser controllers implement.
 *             This is the plugin contract. The application never talks
 *             to serial ports directly — only through this interface.
 *
 *             Adding a new controller type (Marlin, Ruida, etc.) means
 *             implementing this interface. Nothing else changes.
 *
 * Dependencies:
 *   - /src/communication/SerialPort.ts
 *   - /src/core/output/Output.ts
 * Last updated: Phase 6, Step 21 — Controller interface
 */

import { type SerialPortLike } from '../communication/SerialPort';
import { type Output } from '../core/output/Output';

// ─── MACHINE STATE ───────────────────────────────────────────────

export type MachineStatus =
  | 'disconnected'
  | 'connecting'
  | 'idle'
  | 'run'
  | 'hold'
  | 'alarm'
  | 'homing'
  | 'check';

export interface MachinePosition {
  x: number;
  y: number;
  z: number;
}

export interface MachineState {
  status: MachineStatus;
  position: MachinePosition;
  feedRate: number;          // mm/min
  spindleSpeed: number;      // S-value (maps to laser power)
  alarmCode: number | null;
  errorCode: number | null;
}

// ─── JOB PROGRESS ────────────────────────────────────────────────

export interface JobProgress {
  linesSent: number;
  linesAcknowledged: number;
  totalLines: number;
  percentComplete: number;
  elapsedMs: number;
  bufferFill: number;        // Bytes currently in device buffer
}

// ─── EVENT CALLBACKS ─────────────────────────────────────────────

export type StateChangeCallback = (state: MachineState) => void;
export type ProgressCallback = (progress: JobProgress) => void;
export type ErrorCallback = (code: number, message: string) => void;
export type RawLineCallback = (line: string, direction: 'tx' | 'rx') => void;
export type Unsubscribe = () => void;

// ─── CONTROLLER INTERFACE ────────────────────────────────────────

export interface LaserController {
  /** Human-readable protocol name. */
  readonly protocolName: string;

  /** Current machine state (read-only snapshot). */
  readonly state: MachineState;

  /** Whether a job is currently running. */
  readonly isJobRunning: boolean;

  // ─── Lifecycle ───
  connect(port: SerialPortLike): Promise<void>;
  disconnect(): Promise<void>;

  // ─── Job Execution ───
  sendJob(output: Output): void;
  pause(): void;
  resume(): void;
  stop(): void;

  // ─── Manual Control ───
  sendCommand(command: string): void;
  requestStatusReport(): void;

  // ─── Events ───
  onStateChange(callback: StateChangeCallback): Unsubscribe;
  onProgress(callback: ProgressCallback): Unsubscribe;
  onError(callback: ErrorCallback): Unsubscribe;
  onRawLine(callback: RawLineCallback): Unsubscribe;
}
