/**
 * Abstract interface that all laser controllers implement.
 * Adding a new controller type (Marlin, Ruida, etc.) means
 * implementing this interface. Nothing else changes.
 */

import { type SerialPortLike } from '../communication/SerialPort';

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
  feedRate: number;
  spindleSpeed: number;
  alarmCode: number | null;
  errorCode: number | null;
}

export interface JobProgress {
  linesSent: number;
  linesAcknowledged: number;
  totalLines: number;
  percentComplete: number;
  elapsedMs: number;
  bufferFill: number;
}

export type StateChangeCallback = (state: MachineState) => void;
export type ProgressCallback = (progress: JobProgress) => void;
export type ErrorCallback = (code: number, message: string) => void;
export type RawLineCallback = (line: string, direction: 'tx' | 'rx') => void;
export type Unsubscribe = () => void;

export interface LaserController {
  readonly protocolName: string;
  readonly state: MachineState;
  readonly isJobRunning: boolean;
  /** GRBL $30 (max spindle/PWM). Null until parsed from a $$ response after connect. */
  readonly maxSpindle: number | null;

  connect(port: SerialPortLike): Promise<void>;
  disconnect(): Promise<void>;

  sendJob(lines: string[]): void;
  pause(): void;
  resume(): void;
  stop(): void;
  /** Soft reset — use only for true emergency (position may be lost). */
  emergencyStop(): void;

  sendCommand(command: string): void;
  requestStatusReport(): void;

  onStateChange(callback: StateChangeCallback): Unsubscribe;
  onProgress(callback: ProgressCallback): Unsubscribe;
  onError(callback: ErrorCallback): Unsubscribe;
  onRawLine(callback: RawLineCallback): Unsubscribe;
}
