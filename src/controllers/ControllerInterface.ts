/**
 * Controller contracts.
 *
 * T2-24 splits the future protocol-neutral core from today's GRBL line-stream
 * facade. `LaserController` remains as a legacy compatibility name for the
 * current GRBL-shaped API while follow-up tickets migrate generic services to
 * the narrower protocol-neutral interfaces.
 */

import { type SerialPortLike } from '../communication/SerialPort';
import type { SafetyActionResult } from './SafetyActionResult';
import type { GcodeStartMode } from '../core/output/GcodeOrigin';
// T1-163 (audit F-001): surface the T1-116 token type so the
// setStopOnError signature declares its safety contract.
import type { UnsafeStopOnErrorOverrideToken } from './grbl/StopOnErrorOverrideToken';

export type MachineStatus =
  | 'disconnected'
  | 'connecting'
  | 'idle'
  | 'run'
  | 'hold'
  | 'alarm'
  | 'homing'
  | 'check'
  // T1-followup-safety-door: GRBL `Door` reports indicate the safety
  // interlock is active (door open, e-stop, lid switch, etc). Pre-T1-
  // followup-safety-door the live status parser silently dropped
  // `<Door|...>` reports and `_classifySafeStateReason` carried an
  // explicit `'door' is intentionally not classified` carve-out, so
  // a live door-open event during idle would not block job start /
  // jog / frame / test-fire. Now `door` is a first-class status
  // recognized by `_handleStatusReport`, `MachinePreflight`,
  // `_classifySafeStateReason`, and the OperationGate / safety-state
  // surfaces.
  | 'door'
  // T2-12 part 2: software-synthesized state when an error occurs
  // during an active job. Distinct from 'alarm' (which is hardware-
  // reported by GRBL and recoverable via $X). Faulted means the
  // controller stopped a job mid-execution and the machine state is
  // uncertain enough that the user should physically inspect before
  // retrying. Recovery is via {@link LaserController.acknowledgeFault}
  // rather than $X.
  | 'faulted_requires_inspection';

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

export interface ProtocolNeutralJobProgress {
  percentComplete: number;
  elapsedMs: number;
}

export interface GrblLineStreamProgress extends ProtocolNeutralJobProgress {
  linesSent: number;
  linesAcknowledged: number;
  totalLines: number;
  bufferFill: number;
  /** GRBL streaming health: buffer fill vs ok-ack rate. */
  healthStatus: 'healthy' | 'warning' | 'saturated';
  /** Rolling ok rate from recent acks (acks/s). Null until enough samples. */
  ackRateHz: number | null;
  /** Recent command send rate (sends/s), used as expected ack rate. Null until enough samples. */
  expectedAckRateHz: number | null;
}

export interface JobProgress extends GrblLineStreamProgress {}

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

export type ControllerFamily =
  | 'gcode-line-stream'
  | 'grbl'
  | 'binary-stream'
  | 'file-upload'
  | 'device-native';

export interface SerialConnectionDescriptor {
  kind: 'serial';
  port: SerialPortLike;
}

export interface WebSocketConnectionDescriptor {
  kind: 'websocket';
  url: string;
  protocols?: string | string[];
}

export interface FileUploadConnectionDescriptor {
  kind: 'file-upload';
  endpoint?: string;
}

export type ConnectionDescriptor =
  | SerialConnectionDescriptor
  | WebSocketConnectionDescriptor
  | FileUploadConnectionDescriptor;

export type ControllerOutput =
  | { kind: 'gcode-lines'; lines: readonly string[]; dialect: 'grbl' | 'marlin' | 'smoothie' | string }
  | { kind: 'gcode-text'; text: string; dialect: string }
  | { kind: 'binary-job'; bytes: Uint8Array; format: 'ruida' | 'trocen' | string }
  | { kind: 'device-job'; payload: unknown; format: string };

export interface ControllerJobTicket {
  ticketId: string;
  sceneHash?: string;
  profileHash?: string;
  outputHash?: string;
}

export interface JobHandle {
  id: string;
  startedAt: number;
}

export type OperationResult =
  | { ok: true; message?: string }
  | { ok: false; reason: string; message?: string };

export type FrameOperationResult =
  | { ok: true; message?: string }
  | { ok: false; reason: string; message?: string; blockedAtLine?: number };

/**
 * T3-50: snapshot of device identity captured during the connect handshake.
 *
 * `firmwareVersion` and `buildOptions` come from the GRBL `$I` response
 * lines (`[VER:...]` / `[OPT:...]`); the bed/spindle/laser/homing fields
 * come from the `$$` settings dump. Each field is `null` when the
 * controller has not (yet) reported it — fingerprinting is best-effort,
 * and a controller that drops `$I` packets still produces a partial
 * identity rather than rejecting the connect.
 *
 * Used by:
 *  - preflight rules (T3-57) to compare profile vs live identity
 *  - ConnectionManager (T2-32, future) for profile-binding checks
 *  - reconnect-same-machine verification (T3-51, future)
 *  - T3-58 capability-confidence UI rendering
 */
export interface DeviceIdentity {
  readonly firmwareVersion: string | null;
  readonly buildOptions: string | null;
  readonly maxSpindle: number | null;
  readonly bedWidthMm: number | null;
  readonly bedHeightMm: number | null;
  readonly homingDirection: number | null;
  readonly homingEnabled: boolean | null;
  readonly laserMode: boolean | null;
  /** T3-57: GRBL `$110` max X feed rate (mm/min). null until reported. */
  readonly maxRateXMmPerMin?: number | null;
  /** T3-57: GRBL `$111` max Y feed rate (mm/min). null until reported. */
  readonly maxRateYMmPerMin?: number | null;
  /** T3-57: GRBL `$120` max X acceleration (mm/s²). null until reported. */
  readonly maxAccelXMmPerS2?: number | null;
  /** T3-57: GRBL `$121` max Y acceleration (mm/s²). null until reported. */
  readonly maxAccelYMmPerS2?: number | null;
}

export interface DisconnectOptions {
  reason?: string;
  skipStop?: boolean;
}

export interface MachineOperationApi {
  jog(args: { axis: 'X' | 'Y' | 'Z'; distanceMm: number; feedMmPerMin: number; onCommand?: (line: string) => void }): Promise<OperationResult>;
  home(args?: { onCommand?: (line: string) => void }): Promise<OperationResult>;
  unlockAlarm(args?: { onCommand?: (line: string) => void }): Promise<OperationResult>;
  setWorkOriginAtCurrentPosition(args?: { onCommand?: (line: string) => void }): Promise<OperationResult>;
  resetWcsToMachineOrigin(args?: { onCommand?: (line: string) => void }): Promise<OperationResult>;
  testFire(args: { powerPercent: number; maxSpindle: number; onCommand?: (line: string) => void }): Promise<OperationResult>;
  frame(args: {
    corners: readonly { x: number; y: number }[];
    startMode: GcodeStartMode;
    laserMode: 'off' | 'dot';
    maxSpindle: number;
    frameDotFeedRateMmPerMin?: number;
    crosshairAfterFrame?: boolean;
    onCommand?: (line: string) => void;
    lineDelayMs?: number;
  }): Promise<FrameOperationResult>;
  laserOff(opts?: { emergency?: boolean; onCommand?: (line: string) => void }): Promise<OperationResult>;
  pauseJob(handle?: JobHandle): Promise<OperationResult>;
  resumeJob(handle?: JobHandle): Promise<OperationResult>;
  stopJob(handle?: JobHandle, reason?: string): Promise<OperationResult>;
  emergencyStop(reason?: string): Promise<OperationResult>;
}

export interface ControllerEventBus {
  onStateChange(callback: StateChangeCallback): Unsubscribe;
  onProgress(callback: (progress: ProtocolNeutralJobProgress) => void): Unsubscribe;
  onError(callback: ErrorCallback): Unsubscribe;
}

export interface ProtocolNeutralLaserController {
  readonly id: string;
  readonly family: ControllerFamily;
  readonly state: MachineState;
  readonly isJobRunning: boolean;
  readonly operations: MachineOperationApi;
  readonly events: ControllerEventBus;

  connect(connection: ConnectionDescriptor): Promise<void>;
  disconnect(options?: DisconnectOptions): Promise<void>;
  executeJob(output: ControllerOutput, ticket: ControllerJobTicket): Promise<JobHandle>;
}

export type CommandSource = 'internal' | 'user';

export interface GcodeLineController {
  readonly family: 'gcode-line-stream' | 'grbl';
  connect(port: SerialPortLike, signal?: AbortSignal): Promise<void>;
  executeJob(output: ControllerOutput, ticket: ControllerJobTicket): Promise<JobHandle>;
  sendJob(lines: string[]): Promise<void>;
  sendCommand(command: string, source?: CommandSource): void;
}

export interface GrblControllerApi extends GcodeLineController {
  readonly protocolName: string;
  readonly state: MachineState;
  readonly isJobRunning: boolean;
  readonly operations: MachineOperationApi;
  /** GRBL $30 (max spindle/PWM). Null until parsed from a $$ response after connect. */
  readonly maxSpindle: number | null;

  connect(port: SerialPortLike, signal?: AbortSignal): Promise<void>;
  disconnect(): Promise<void>;

  /**
   * Stream a G-code job. Resolves when acceptance checks pass; streaming then
   * runs asynchronously. Sends a realtime `?` first to avoid stale read of `state.status`.
   */
  executeJob(output: ControllerOutput, ticket: ControllerJobTicket): Promise<JobHandle>;
  sendJob(lines: string[]): Promise<void>;
  pause(): SafetyActionResult;
  /**
   * T1-216 (v30 audit #3): resume awaits the modal-spindle reassert
   * (`M3 S0` / `M4 S0`) before issuing the cycle-start byte. Pre-
   * T1-216 the modal write was fire-and-forget, so motion could
   * resume with whatever modal state the controller had if the
   * critical-write failed. The async contract is required to gate
   * the cycle-start byte on confirmed-on-the-wire modal restore.
   */
  resume(): Promise<SafetyActionResult>;
  stop(): SafetyActionResult;
  /** Soft reset — use only for true emergency (position may be lost). */
  emergencyStop(): SafetyActionResult;

  /**
   * Two-stage hardware laser-off (T1-22). Awaitable; never throws — returns a
   * structured outcome the caller can act on. Stage 1 attempts `M5 S0` via the
   * port's critical-write path. On failure, stage 2 falls back to soft reset
   * (`0x18`), GRBL's actual realtime emergency stop. The caller (typically
   * {@link ExecutionCoordinator.emergencyLaserOff}) uses the returned stage to
   * notify {@link MachineService.notifyLaserSafetyOutcome} which gates job
   * starts when laser state becomes uncertain.
   */
  safetyOff(): Promise<{
    stage: 'm5' | 'soft-reset' | 'failed';
    error?: Error;
  }>;

  /**
   * T2-12 part 2: clear a 'faulted_requires_inspection' state and
   * return the controller to 'idle'. Should only be called after the
   * user has physically inspected the machine and confirmed it is
   * safe to proceed.
   *
   * Implementations should:
   *  - Confirm motion has stopped.
   *  - Call {@link safetyOff} as defense-in-depth (fire-and-forget;
   *    the original fault path already invoked it once).
   *  - Transition status to 'idle' if the controller is currently in
   *    'faulted_requires_inspection'; otherwise no-op.
   *
   * No-op on controllers that don't surface the faulted state. Returns
   * `{ ok: true }` on success or no-op; `{ ok: false, reason }` if the
   * acknowledge couldn't be processed (e.g. disconnected, motion still
   * running). Never throws.
   */
  acknowledgeFault?(): Promise<{ ok: boolean; reason?: string }>;

  /**
   * Manual line to GRBL. `internal` = LaserForge-generated (known sequences);
   * `user` = console / operator-typed (semantic gating is the UI’s responsibility).
   */
  sendCommand(command: string, source?: CommandSource): void;
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
   * GRBL: $32 laser mode. `true` = $32=1 (laser dynamic mode), `false` = $32=0 (CNC/spindle mode),
   * `undefined` if not read yet. T1-32: jobs that emit M4 must verify $32=1; in CNC mode M4 keeps
   * the laser on at full power between motion commands which is dangerous for diode lasers.
   */
  getFirmwareLaserModeEnabled?(): boolean | undefined;
  /**
   * T1-25: safe-state verdict captured at connect (first status report after
   * the welcome handshake, or null if the handshake passed: idle + FS 0,0).
   * Non-null means the controller was in alarm / run / hold / check / had
   * residual spindle, or never reported status at all — UI / preflight must
   * refuse machine control until the user reconnects from a known-safe state.
   */
  getUnsafeAtConnect?(): {
    reason: 'alarm' | 'run' | 'hold' | 'door' | 'check' | 'no-status-response' | 'unsafe-residual-spindle';
    capturedAt: number;
    status: MachineStatus;
    alarmCode: number | null;
    feedRate: number;
    spindleSpeed: number;
  } | null;
  /**
   * GRBL: G54 (from the last $#) and $10 (from the last $$). Nulls until a successful dump
   * during the current connect handshake.
   */
  getCurrentWcsState?(): { g54: { x: number; y: number; z: number } | null; statusMask: number | null };
  /**
   * T1-41: GRBL: query `$#` and resolve with the freshly-parsed G54 work
   * offset, or `null` if the controller is disconnected or the response
   * did not arrive within the timeout. Used by saved-origin verification
   * to detect WCS drift between Set Origin and job start.
   */
  requestWorkOffsets?(timeoutMs?: number): Promise<{ x: number; y: number; z: number } | null>;
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
   * T1-20: GRBL: returns true if the WCS consent flow encountered a
   * no-listener fallback without the `allowHeadlessWcsAutoNormalize`
   * option. The UI must gate job start on this - placement-uncertain
   * controllers should refuse to start jobs because the WCS state may
   * be set to something the user wants to preserve, and we couldn't
   * ask. Recovery is disconnect -> attach listener -> reconnect.
   *
   * Optional; non-GRBL controllers don't need to implement it. UI code
   * defaults to false (not uncertain) when not implemented.
   */
  getPlacementUncertain?(): boolean;
  /**
   * T1-203: when `getPlacementUncertain()` returns true, returns the
   * structured reason (one of the `WcsUncertainReason` literals or
   * null). UI code reads this so the start-readiness gate can show a
   * cause-specific recovery hint instead of a single misleading "no
   * consent prompt" message that applied to only one of four causes.
   *
   * The return type is structurally typed (any string-or-null) at the
   * interface layer so non-GRBL controllers can stay free of GRBL
   * dialect concerns. The UI narrows via `as WcsUncertainReason |
   * null` at the call site.
   */
  getPlacementUncertainReason?(): string | null;
  /**
   * T1-220 (v30 audit #8): number of job lines this controller has
   * written to the transport since the most recent `sendJob()` /
   * `executeJob()` call. Used by MachineService's failed-start
   * carve-out to decide whether to clear the unsafe-prior-state
   * flag — any non-zero count means machine-affecting output
   * streamed.
   *
   * Optional; non-GRBL controllers can omit. Callers default to
   * 0 when not implemented (matches the pre-T1-220 behaviour).
   */
  getJobLinesWrittenSinceJobStart?(): number;
  /**
   * Configure whether a running job is aborted on GRBL `error:` responses.
   * Optional; defaults to true when not implemented.
   *
   * T1-163 (audit F-001): the runtime gate in `GrblController.setStopOnError`
   * requires an {@link UnsafeStopOnErrorOverrideToken} when `value === false`.
   * Pre-T1-163 the interface signature didn't declare the token slot, so
   * a caller wired against the interface alone had no compile-time signal
   * that the override was gated. Post-T1-163 the token slot is part of
   * the contract; callers see at compile time that disabling
   * stop-on-error requires a token. The runtime gate remains the
   * load-bearing defense.
   */
  setStopOnError?(value: boolean, token?: UnsafeStopOnErrorOverrideToken): void;
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

export interface LaserController extends GrblControllerApi {}

export function isGrblControllerApi(controller: unknown): controller is GrblControllerApi {
  if (controller == null || typeof controller !== 'object') return false;
  const candidate = controller as Partial<GrblControllerApi>;
  return (
    typeof candidate.sendCommand === 'function'
    && typeof candidate.sendJob === 'function'
    && typeof candidate.safetyOff === 'function'
    && typeof candidate.requestStatusReport === 'function'
  );
}
