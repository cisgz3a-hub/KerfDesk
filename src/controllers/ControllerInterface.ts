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
  /** GRBL streaming health: buffer fill vs ok-ack rate. */
  healthStatus: 'healthy' | 'warning' | 'saturated';
  /** Rolling ok rate from recent acks (acks/s). Null until enough samples. */
  ackRateHz: number | null;
  /** Recent command send rate (sends/s), used as expected ack rate. Null until enough samples. */
  expectedAckRateHz: number | null;
}

export type StateChangeCallback = (state: MachineState) => void;
export type ProgressCallback = (progress: JobProgress) => void;
export type ErrorCallback = (code: number, message: string) => void;
/**
 * Called for each line crossing the serial boundary.
 *
 * @param line      The raw line text (no trailing newline).
 * @param direction 'tx' = app → machine, 'rx' = machine → app.
 * @param kind      'user' (default) for lines a user typed or that
 *                  originated from a scene job. 'system' for lines
 *                  the controller emits automatically on its own
 *                  behalf (post-connect handshake, internal config).
 *                  Consumers that don't care can ignore this arg.
 */
export type RawLineCallback = (
  line: string,
  direction: 'tx' | 'rx',
  kind?: 'user' | 'system',
) => void;
/**
 * Fired when the currently-active source object(s) change during
 * a running job. An empty array means no object is currently being
 * burned (between operations or at job end).
 *
 * Derived from ; OBJ ids=... markers embedded in the gcode by the
 * planner, parsed and stripped from the machine stream during sendJob.
 */
export type ObjectLifecycleCallback = (
  activeObjectIds: readonly string[],
) => void;
export type Unsubscribe = () => void;

/** Snapshot of work coordinate system and status report mask before LaserForge WCS baseline is applied. */
export interface WcsConsentSnapshot {
  g54: { x: number; y: number; z: number };
  statusMask: number;
}

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
  /**
   * Optional controller-native autofocus trigger.
   * Serial GRBL controllers can implement this; other controllers may omit it.
   */
  runAutoFocus?(command: string, timeoutMs?: number): Promise<void>;
  /**
   * GRBL: $22 homing cycle. `true` = enabled, `false` = disabled, `undefined` if not read yet.
   */
  getFirmwareHomingCycleEnabled?(): boolean | undefined;
  /**
   * GRBL: G54 (from the last $#) and $10 (from the last $$). Nulls until a successful dump
   * during the current connect handshake.
   */
  getCurrentWcsState?(): { g54: { x: number; y: number; z: number } | null; statusMask: number | null };
  /**
   * GRBL: Fired when connect-time normalization would change G54 and/or $10. Call
   * `applyWcsNormalization` to apply the baseline, or `skipWcsNormalization` to leave
   * firmware as-is. Not all controllers implement this.
   */
  onWcsConsentNeeded?(callback: (state: WcsConsentSnapshot) => void): Unsubscribe;
  /**
   * GRBL: Apply G10 L2 (G54=0) and $10=0. Only call after the user has agreed in response
   * to `onWcsConsentNeeded` (or when the controller auto-applied because the machine was
   * already in the baseline state).
   */
  applyWcsNormalization?(): void;
  /**
   * GRBL: Mark settings handshake done without writing G10 / $10 (user declined or error).
   */
  skipWcsNormalization?(): void;
  /**
   * Configure whether a running job is aborted on GRBL `error:` responses.
   * Optional; defaults to true when not implemented.
   */
  setStopOnError?(value: boolean): void;
  requestStatusReport(): void;

  onStateChange(callback: StateChangeCallback): Unsubscribe;
  onProgress(callback: ProgressCallback): Unsubscribe;
  onError(callback: ErrorCallback): Unsubscribe;
  onRawLine(callback: RawLineCallback): Unsubscribe;
  /**
   * Subscribe to source-object activation changes during a job.
   * See ObjectLifecycleCallback. Optional for non-GRBL controllers / tests.
   */
  onObjectLifecycle?(callback: ObjectLifecycleCallback): Unsubscribe;
}
