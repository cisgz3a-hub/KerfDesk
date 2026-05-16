/**
 * GRBL 1.1 controller with character-counting buffer management.
 * Pipelines G-code for maximum throughput — no stuttering.
 */

import {
  type GrblControllerApi,
  type MachineState,
  type MachineStatus,
  type JobProgress,
  type OperationResult,
  type FrameOperationResult,
  type StateChangeCallback,
  type ProgressCallback,
  type ErrorCallback,
  type RawLineCallback,
  type ObjectLifecycleCallback,
  type SafetyOffOutcome,
  type SafetyOffOutcomeCallback,
  type SafetyOffOutcomeSource,
  type SafetyOffOutcomeStage,
  type Unsubscribe,
  type WcsConsentSnapshot,
  type ControllerJobTicket,
  type ControllerOutput,
  type DeviceIdentity,
  type JobHandle,
} from '../ControllerInterface';
import { type SerialPortLike } from '../../communication/SerialPort';
import type { SpoolHandle } from '../../core/output/GcodeStreaming';
import type { GcodeChunk } from '../../core/output/GcodeStreaming';
import {
  ConnectionGenerationAllocator,
  contextFromToken,
  isStaleContext,
  withGenerationGuard,
  type ConnectionToken,
} from '../../communication/ConnectionGenerationGuard';
import { computeStreamingHealth } from './streamingHealth';
import { buildGrblFrameGcode } from './GrblFrameGcode';
import { parseGrblStatusReport } from './GrblStatusReportParser';
import {
  interpretGrblSettingValue,
  parseGrblSettingLine,
} from './GrblSettingsParser';
import { parseGrblG54WcsLine } from './GrblWcsParser';
import { classifyGrblSafeState } from './GrblSafeStateClassifier';
// T1-134: pure job-line + OBJ-id marker parser extracted so the
// gcode-line → object-id mapping contract is unit-testable in isolation.
import {
  createGrblJobLineParserState,
  type GrblJobLineParserState,
  parseGrblJobLineChunk,
  parseGrblJobLines,
} from './GrblJobLineParser';
// T1-137: pure $I identity-line parser extracted so the
// [VER:...] / [OPT:...] grammar is testable without mounting the controller.
import { parseGrblIdentityLine } from './GrblIdentityParser';
// T1-139: pure job-bounds checker (the controller-layer
// defense-in-depth that scans G0/G1 X/Y moves against bed extents,
// including the T1-44 relative-mode simulated-cursor path).
import {
  checkGrblJobBounds,
  checkGrblJobBoundsChunk,
  createGrblJobBoundsState,
  type GrblJobBoundsContext,
} from './GrblJobBoundsChecker';
import {
  type SafetyActionResult,
  makeEmergencyStopResult,
  makeNotConnectedResult,
  makePauseResult,
  makeResumeResult,
  makeSoftResetStopResult,
} from '../SafetyActionResult';
import { appendStructuredDiagnosticLogEvent } from '../../core/logging/StructuredDiagnosticLog';

const GRBL_BUFFER_SIZE = 127;
const STATUS_POLL_INTERVAL = 200;
const JOB_STATUS_REPLY_WARN_MS = 1500;
const JOB_NO_RX_ABORT_MS = 8000;
const REALTIME_STATUS = 0x3F;
const REALTIME_FEED_HOLD = 0x21; // '!'
const REALTIME_CYCLE_START = 0x7E; // '~'
const REALTIME_RESET = 0x18;
const STREAM_JOB_WINDOW_LINES = 2048;


interface PendingLine {
  text: string;
  byteCount: number;
  marker?: readonly string[] | null;
  system?: boolean;
}

interface SafetyOffResult {
  stage: SafetyOffOutcomeStage;
  error?: Error;
}

export class AutoFocusSafetyOffError extends Error {
  readonly safetyOffStage: SafetyOffOutcomeStage;
  readonly safetyOffError?: Error;

  constructor(message: string, result: SafetyOffResult) {
    super(message);
    this.name = 'AutoFocusSafetyOffError';
    this.safetyOffStage = result.stage;
    if (result.error != null) {
      this.safetyOffError = result.error;
    }
  }
}

/**
 * T1-20: optional construction-time settings for GrblController.
 *
 * `allowHeadlessWcsAutoNormalize`: when true, the WCS consent flow's
 * no-listener fallback path keeps the pre-T1-20 behavior of silently
 * applying normalization. Default false: the no-listener path instead
 * marks the controller placement-uncertain and the UI gates job start.
 *
 * Tests that need the pre-T1-20 auto-apply behavior pass `true`.
 * Production code (App.tsx) leaves the option unset - the UI always
 * registers a listener via onWcsConsentNeeded before connect, and the
 * fallback is a no-go-to safety net.
 */
export interface GrblControllerOptions {
  allowHeadlessWcsAutoNormalize?: boolean;
}

/**
 * T1-202: an injected callback that lets the controller surface
 * controller-layer safety events to the `app` layer without creating
 * a reverse `controllers → app` dependency. The application (via
 * `useControllerConnection`) registers a sink that forwards each
 * event to `MachineEventLedger.append(...)`. Pre-T1-202 these events
 * existed only as `console.warn` traces in the controller; support
 * bundles couldn't reconstruct WCS-query failures or placement-
 * uncertain transitions after a renderer crash.
 *
 * The payloads match the MachineEvent discriminated-union shapes
 * exactly so the sink implementation can pass them through unchanged.
 */
export type ControllerSafetyEvent =
  | { readonly kind: 'wcs-query-error'; readonly t: number; readonly grblErrorLine: string }
  | { readonly kind: 'placement-uncertain'; readonly t: number; readonly reason: string };

export type ControllerSafetyEventSink = (event: ControllerSafetyEvent) => void;

/** First field inside `<...|...>` GRBL realtime reports (e.g. `Hold:0`). */
function parseGrblStatusReportStateToken(line: string): string | null {
  if (!line.startsWith('<') || !line.endsWith('>')) return null;
  const pipe = line.indexOf('|');
  if (pipe <= 1) return null;
  return line.slice(1, pipe).toLowerCase();
}

/** Map GRBL report token to app status; null if this is not a GRBL status line we should trust. */
function machineStatusFromGrblReportToken(token: string): MachineStatus | null {
  const exact: Record<string, MachineStatus> = {
    idle: 'idle',
    run: 'run',
    hold: 'hold',
    'hold:0': 'hold',
    'hold:1': 'hold',
    alarm: 'alarm',
    home: 'homing',
    check: 'check',
  };
  if (exact[token]) return exact[token];
  if (token.startsWith('hold')) return 'hold';
  if (token.startsWith('door')) return 'hold';
  if (token.startsWith('sleep')) return 'check';
  if (token.startsWith('jog')) return 'run';
  if (token.startsWith('alarm')) return 'alarm';
  return null;
}

/**
 * T1-25: reasons a controller can be reported as unsafe-at-connect. Each
 * value maps to a distinct UI message that names the recovery action. The
 * `'no-status-response'` reason fires when the watchdog elapses without any
 * `<...>` status reaching the parser — typically a wedged firmware or a
 * non-responsive cable.
 */
// T1-163 (audit F-001): UnsafeStopOnErrorOverrideToken + factory +
// type-guard moved to ./StopOnErrorOverrideToken so ControllerInterface
// can import the type and surface the token slot in the
// `setStopOnError` signature. GrblController re-exports the public
// surface (UnsafeStopOnErrorOverrideToken type + createStopOnErrorOverrideToken
// factory) so existing tests under `tests/stop-on-error-*` keep working
// unchanged.
import {
  type UnsafeStopOnErrorOverrideToken,
  createStopOnErrorOverrideToken,
  isUnsafeStopOnErrorOverrideToken,
} from './StopOnErrorOverrideToken';
export type { UnsafeStopOnErrorOverrideToken };
export { createStopOnErrorOverrideToken };

// T1-178 (external audit High #4): boundary validators for jog /
// testFire / frame args. The controller refuses to compose a G-code
// line from invalid numbers — defense-in-depth against any UI bypass
// that would otherwise send dangerous motion.
import {
  validateJogArgs,
  validateTestFireArgs,
  validateFrameArgs,
} from './grblOperationValidators';
export {
  InvalidOperationArgumentError,
  validateJogArgs,
  validateTestFireArgs,
  validateFrameArgs,
} from './grblOperationValidators';

// T1-152: WcsUncertainReason / WcsConsentVerdict /
// classifyWcsConsentInputs moved to ./GrblWcsConsentClassifier.
// Internal callers import locally; the public surface is preserved
// via the explicit re-exports below.
import {
  classifyWcsConsentInputs,
  type WcsConsentVerdict,
  type WcsUncertainReason,
} from './GrblWcsConsentClassifier';
export type { WcsConsentVerdict, WcsUncertainReason };
export { classifyWcsConsentInputs };

// T1-153: UnsafeAtConnectReason + UnsafeAtConnectState moved to
// ./GrblUnsafeAtConnect. Internal callers import locally; the
// public surface is preserved via re-exports.
import type {
  UnsafeAtConnectReason,
  UnsafeAtConnectState,
} from './GrblUnsafeAtConnect';
export type { UnsafeAtConnectReason, UnsafeAtConnectState };

/** Parsed machine limits from GRBL $$ (defaults until first successful dump). */
export interface GrblMachineInfo {
  bedWidth: number;
  bedHeight: number;
  homingDir: number;
  maxSpindle: number;
  laserMode: boolean;
  maxFeedX: number;
  maxFeedY: number;
  /** $120 max X acceleration (mm/s²). */
  maxAccelX: number;
  /** $121 max Y acceleration (mm/s²). */
  maxAccelY: number;
}

export class GrblController implements GrblControllerApi {
  readonly family = 'grbl' as const;
  readonly protocolName = 'GRBL 1.1';
  readonly operations = {
    jog: async (args: { axis: 'X' | 'Y' | 'Z'; distanceMm: number; feedMmPerMin: number; onCommand?: (line: string) => void }): Promise<OperationResult> => {
      // T1-178 (audit High #4): validate at the boundary before
      // composing the G-code line. Throws InvalidOperationArgumentError
      // on bad numeric input — the operation API surface is async, so
      // the throw rejects the returned promise, never reaches the wire.
      validateJogArgs(args);
      return this._trySendInternalOperationCommand(
        `$J=G91 G21 ${args.axis}${args.distanceMm} F${args.feedMmPerMin}`, args.onCommand,
      );
    },
    home: async (args?: { onCommand?: (line: string) => void }): Promise<OperationResult> =>
      this._trySendInternalOperationCommand('$H', args?.onCommand),
    unlockAlarm: async (args?: { onCommand?: (line: string) => void }): Promise<OperationResult> =>
      this._trySendInternalOperationCommand('$X', args?.onCommand),
    setWorkOriginAtCurrentPosition: async (args?: { onCommand?: (line: string) => void }): Promise<OperationResult> =>
      this._trySendInternalOperationCommand('G10 L20 P1 X0 Y0', args?.onCommand),
    resetWcsToMachineOrigin: async (args?: { onCommand?: (line: string) => void }): Promise<OperationResult> =>
      this._trySendInternalOperationCommand('G10 L2 P1 X0 Y0 Z0', args?.onCommand),
    testFire: async (args: { powerPercent: number; maxSpindle: number; onCommand?: (line: string) => void }): Promise<OperationResult> => {
      // T1-178 (audit High #4): validate at the boundary. Pre-T1-178
      // the computation clamped only the lower bound — a powerPercent
      // of 500 with maxSpindle=1000 would emit `M3 S5000` (5× the
      // PWM ceiling). Post-T1-178 the validator rejects out-of-range
      // powerPercent / maxSpindle before any G-code is composed.
      validateTestFireArgs(args);
      const sVal = Math.max(0, Math.round((args.powerPercent / 100) * args.maxSpindle));
      return this._trySendInternalOperationCommand(`M3 S${sVal}`, args.onCommand);
    },
    frame: async (args: {
      corners: readonly { x: number; y: number }[];
      startMode: 'absolute' | 'current';
      laserMode: 'off' | 'dot';
      maxSpindle: number;
      frameDotFeedRateMmPerMin?: number;
      crosshairAfterFrame?: boolean;
      onCommand?: (line: string) => void;
      lineDelayMs?: number;
    }): Promise<FrameOperationResult> => {
      // T1-178 (audit High #4): validate corners, maxSpindle, feed at
      // the boundary. Each corner must have finite XY; maxSpindle and
      // (optional) frameDotFeedRate must be finite + positive.
      validateFrameArgs({
        corners: args.corners,
        maxSpindle: args.maxSpindle,
        frameDotFeedRateMmPerMin: args.frameDotFeedRateMmPerMin,
      });
      const lines = buildGrblFrameGcode(args.corners, {
        startMode: args.startMode,
        laserMode: args.laserMode,
        maxSpindle: args.maxSpindle,
        frameDotFeedRateMmPerMin: args.frameDotFeedRateMmPerMin,
        crosshairAfterFrame: args.crosshairAfterFrame,
      });
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const result = await this._trySendInternalOperationCommand(line, args.onCommand);
        if (!result.ok) {
          return {
            ok: false,
            reason: 'command-blocked',
            message: result.message ?? result.reason,
            blockedAtLine: i,
          };
        }
        if ((args.lineDelayMs ?? 0) > 0) {
          await new Promise(r => setTimeout(r, args.lineDelayMs));
        }
      }
      return { ok: true };
    },
    laserOff: async (opts?: { emergency?: boolean; onCommand?: (line: string) => void }): Promise<OperationResult> => {
      const result = await this.safetyOff();
      if (result.stage === 'm5') {
        opts?.onCommand?.('M5 S0');
        return { ok: true, message: 'Laser off confirmed.' };
      }
      return {
        ok: false,
        reason: result.stage,
        message: result.error?.message,
      };
    },
    pauseJob: async (): Promise<OperationResult> => {
      try {
        return this._operationFromSafetyResult(await this.pause());
      } catch (err: unknown) {
        return this._operationError(err);
      }
    },
    resumeJob: async (): Promise<OperationResult> => {
      try {
        // T1-216: this.resume() is now async (awaits the modal
        // reassert before cycle-start). Await it here before
        // unwrapping into the OperationResult shape.
        return this._operationFromSafetyResult(await this.resume());
      } catch (err: unknown) {
        return this._operationError(err);
      }
    },
    stopJob: async (): Promise<OperationResult> => {
      try {
        return this._operationFromSafetyResult(this.stop());
      } catch (err: unknown) {
        return this._operationError(err);
      }
    },
    emergencyStop: async (): Promise<OperationResult> => {
      try {
        return this._operationFromSafetyResult(this.emergencyStop());
      } catch (err: unknown) {
        return this._operationError(err);
      }
    },
  };

  private _state: MachineState;
  private _port: SerialPortLike | null = null;
  private readonly _connectionGenerations = new ConnectionGenerationAllocator();
  private _activeConnectionToken: ConnectionToken | null = null;
  private _isJobRunning = false;
  /**
   * T1-220 (v30 audit #8): monotonic counter of job lines written
   * to the transport since the most recent sendJob() call. Used by
   * MachineService.startValidatedJob's failed-start carve-out to
   * decide whether to clear the unsafe-prior-state flag. Unlike
   * _isJobRunning (a boolean that an aborted-job code path can
   * synchronously clear before the catch sees it), this counter
   * survives the abort — once a byte hits the wire, the count is
   * non-zero, and the failed-start branch knows machine-affecting
   * output was streamed regardless of current flag state.
   *
   * Reset to 0 in sendJob() and on _abortJob() / _completeJob().
   * Incremented inside _drainQueue() AFTER each line write so a
   * write that throws never counts.
   */
  private _jobLinesWrittenSinceJobStart = 0;

  private _jobLines: string[] = [];
  /**
   * Per-jobLine source-object ids that activate when this line is sent.
   * Non-null means `; OBJ ids=...` appeared in the gcode before this line.
   * Length matches _jobLines.
   */
  private _lineMarkers: (readonly string[] | null)[] = [];
  /** Dedupe key for the last onObjectLifecycle emission (sorted ids joined). */
  private _lastLifecycleKey: string | null = null;
  private _objectLifecycleListeners = new Set<ObjectLifecycleCallback>();
  private _safetyOffOutcomeListeners = new Set<SafetyOffOutcomeCallback>();
  private _queueIndex = 0;
  private _jobTotalLines = 0;
  private _streamIterator: AsyncIterator<GcodeChunk> | null = null;
  private _streamParserState: GrblJobLineParserState | null = null;
  private _streamDone = false;
  private _streamFillInFlight = false;
  private _pending: PendingLine[] = [];
  private _bufferAvailable = GRBL_BUFFER_SIZE;
  private _linesAcknowledged = 0;
  private _jobStartTime = 0;

  /** Ring buffer of ok-ack timestamps (ms) for rolling ack rate. */
  private _ackTimestamps: number[] = [];
  /** Ring buffer of job-line send timestamps (ms) for expected ack rate. */
  private _sendTimestamps: number[] = [];
  /**
   * T1-125: ring-buffer capacity. Pre-T1-125 this was 100 samples;
   * the streaming-health computation in `streamingHealth.ts` assumed
   * a fixed 5-second window, which over-truncated at high streaming
   * rates (200+ Hz acks → 100 samples covered ~0.5 s, but the rate
   * formula divided by 5 s and reported ~20 Hz). T1-125 switched the
   * rate formula to endpoint-based (`(N-1) / (last - first)`) so the
   * computation is robust regardless of buffer size; 1000 samples
   * keeps trend-detection sensitive over the full 5-second window
   * even at sustained 200 Hz rates. Memory cost: ~16 KB total
   * (1000 × 8-byte numbers, two buffers, only while a job is active
   * — both buffers reset on disconnect, transport-error, and
   * job-start). Per-event push/shift is O(1) amortised; shift on a
   * 1000-element array is fine in V8.
   */
  private readonly ACK_RATE_WINDOW_SIZE = 1000;
  private _stopOnError = true;
  /** Feed-hold sent; ignore stale Run in status reports until Hold is confirmed. */
  private _pausePending = false;
  /** Cycle-start sent; ignore stale Hold until Run is confirmed. */
  private _resumeRequested = false;

  /** Parsed GRBL $30 (max spindle/PWM). Null until a $$ response includes $30=. */
  private _maxSpindle: number | null = null;
  /** True after post-connect $$ completes (ok received) and optional WCO / $10 sync runs. */
  private _settingsQueried = false;

  /** All $N=value lines from the latest $$ dump (number → raw value string). */
  private readonly _grblSettings = new Map<number, string>();
  private _homingDir = 0;
  private _laserMode = false;
  /**
   * T3-50: device identity captured from the `$I` response. `firmwareVersion`
   * is the payload of `[VER:...]` (e.g. `1.1h.20221128:` for stock GRBL,
   * sometimes with a trailing build tag). `buildOptions` is the payload of
   * `[OPT:...]` (e.g. `VL,15,128`). Both are null until `$I` arrives;
   * cleared at connect-entry and on disconnect so a second connection
   * reading these via `getDeviceIdentity()` does not see a stale snapshot.
   */
  private _firmwareVersion: string | null = null;
  private _buildOptions: string | null = null;
  /**
   * T1-23: last observed modal spindle/laser mode. Pause sends M5 as
   * defense-in-depth, and resume reasserts this mode with S0 before
   * cycle-start so motion continues with the gcode stream's expected mode.
   */
  private _lastSpindleMode: 'M3' | 'M4' | null = null;
  private _bedWidth = 0;
  private _bedHeight = 0;
  private _maxFeedX = 0;
  private _maxFeedY = 0;
  private _maxAccelX = 0;
  private _maxAccelY = 0;
  /** Waiting for trailing `ok` after a `$$` settings dump. */
  private _awaitingSettingsOk = false;
  /**
   * T3-50: waiting for trailing `ok` after a `$I` identity query.
   * Set just before `_writeSystemLine('$I')` in `_queryMachineSettings`
   * and cleared by the first subsequent `ok`. While true, `[VER:...]`
   * / `[OPT:...]` lines route to `_tryParseIdentityLine` in the
   * identity-await branch of `_handleLine`; the trailing `ok` is
   * consumed there before reaching the `_awaitingSettingsOk` branch
   * for `$$`.
   */
  private _awaitingIdentityOk = false;
  /** Waiting for `ok` after a `$#` WCS / parameter report. */
  private _awaitingWcsQueryOk = false;
  /** Waiting for `ok` after a one-off `$#` work-offset request. */
  private _awaitingWorkOffsetRequestOk = false;
  private _workOffsetRequestResolve: ((g54: { x: number; y: number; z: number } | null) => void) | null = null;
  private _workOffsetRequestTimer: ReturnType<typeof setTimeout> | null = null;
  private _currentG54: { x: number; y: number; z: number } | null = null;
  private _wcsConsentListeners = new Set<(state: WcsConsentSnapshot) => void>();
  /**
   * T1-20: when the WCS consent flow finds zero registered listeners and
   * the controller was NOT constructed with allowHeadlessWcsAutoNormalize,
   * the controller marks itself placement-uncertain instead of silently
   * auto-applying. The UI gates job start on this - placement-uncertain
   * controllers should not be allowed to start jobs because the WCS state
   * may be set to something the user wants to preserve, and we couldn't
   * ask. Recovery is disconnect -> ensure listener subscribed -> reconnect.
   *
   * Invariant: false at construction (nothing to be uncertain about
   * yet), false after applyWcsNormalization or skipWcsNormalization
   * (user has resolved the question), false after disconnect (no
   * machine state to be uncertain about).
   */
  private _placementUncertain = false;
  /**
   * T1-117: when `_placementUncertain` becomes true via the WCS-
   * verification fail-closed path, this records WHY (missing G54
   * line, malformed coordinate parse, missing $10, malformed mask
   * parse). Surfaced via `getPlacementUncertainReason()` for UI
   * banners + support diagnostics. Cleared alongside
   * `_placementUncertain` itself.
   */
  private _lastPlacementUncertainReason: WcsUncertainReason | null = null;
  /**
   * T1-20: opt-in for tests / headless callers that need the pre-T1-20
   * auto-apply behavior on no-listener fallback. Default false (production
   * safety > test convenience). See `_emitWcsPayload`.
   */
  private readonly _allowHeadlessWcsAutoNormalize: boolean;

  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _jobStatusHeartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private _jobStatusHeartbeatAwaitingResponse = false;
  private _jobStatusHeartbeatWarned = false;
  private _lastControllerRxAt = 0;

  private _stateListeners: Set<StateChangeCallback> = new Set();
  private _progressListeners: Set<ProgressCallback> = new Set();
  private _errorListeners: Set<ErrorCallback> = new Set();
  private _rawLineListeners: Set<RawLineCallback> = new Set();

  /**
   * T1-44: tracks whether `_state.position` has been populated by an actual
   * status report (wPos or mPos parsed) at any point since connect. The
   * default `{x:0, y:0, z:0}` from the constructor is indistinguishable from
   * "actually at origin" — the flag lets `_checkJobBounds` refuse relative-mode
   * jobs when we genuinely don't know where the head is. Cleared on disconnect.
   */
  private _positionConfirmed = false;

  /**
   * T1-25: armed at connect-welcome time, fires once on the first status
   * report received afterward. The first-status callback computes
   * `_unsafeAtConnect` from the parsed state (status, FS field, alarm code)
   * and disarms the flag. A watchdog timer fires after 5s if no status
   * arrives and records `reason: 'no-status-response'`. Cleared on disconnect.
   */
  private _safeStateCheckArmed = false;
  private _safeStateWatchdog: ReturnType<typeof setTimeout> | null = null;
  private _unsafeAtConnect: UnsafeAtConnectState | null = null;

  /**
   * T1-202: optional sink for surfacing controller-layer safety
   * events (WCS-query-error, placement-uncertain transitions) to the
   * application layer. Production code wires this to
   * `MachineEventLedger.append(...)` in `useControllerConnection`
   * right after construction. Default null = controller runs without
   * ledger emissions (existing console.warn still fires).
   */
  private _safetyEventSink: ControllerSafetyEventSink | null = null;

  constructor(options?: GrblControllerOptions) {
    this._allowHeadlessWcsAutoNormalize = options?.allowHeadlessWcsAutoNormalize === true;
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
  get maxSpindle(): number | null { return this._maxSpindle; }
  /**
   * T1-20: returns true if the controller's WCS consent flow encountered a
   * no-listener fallback (without `allowHeadlessWcsAutoNormalize`). The UI
   * gates job start on this - placement-uncertain controllers should not
   * be allowed to start jobs because the WCS state may be set to something
   * the user wants to preserve, and we couldn't ask. Recovery is
   * disconnect -> ensure listener subscribed -> reconnect.
   */
  getPlacementUncertain(): boolean {
    return this._placementUncertain;
  }

  /**
   * T1-117: returns the reason that `_placementUncertain` is true, when
   * known. The T1-20 no-listener fallback path returns `null` (the
   * uncertainty is structural — the listener race — not data-driven).
   * The T1-117 WCS-verification fail-closed path returns one of
   * `'missing_g54' | 'malformed_g54' | 'missing_status_mask' |
   * 'malformed_status_mask'` so the UI banner / support log can name
   * the specific GRBL response shape that triggered the gate.
   */
  getPlacementUncertainReason(): WcsUncertainReason | null {
    return this._lastPlacementUncertainReason;
  }

  /**
   * When false, GRBL `error:` during a job is logged but streaming may
   * continue. Default true.
   *
   * T1-116: pre-fix this method accepted any boolean, and a casual
   * checkbox in MachineSettingsTab let the user disable stop-on-error
   * with no override / no acknowledgment / persisted across restarts.
   * Continuing past `error:` lines after malformed G-code or unexpected
   * controller state can produce wrong motion, skipped commands, or
   * unsafe job execution. That is not a casual preference. The token
   * gate forces every false-value caller to pass through
   * `createStopOnErrorOverrideToken(reason)` (or the test-only variant)
   * so the override is always paired with an explicit reason string +
   * console warning the user / support / log review can see. Test
   * harnesses pass a token explicitly; production code paths no longer
   * disable stop-on-error.
   */
  setStopOnError(value: boolean, token?: UnsafeStopOnErrorOverrideToken): void {
    if (value === false && !isUnsafeStopOnErrorOverrideToken(token)) {
      throw new Error(
        'GrblController.setStopOnError(false) requires an UnsafeStopOnErrorOverrideToken. '
        + 'Continuing past GRBL error: lines after malformed G-code is unsafe; if you really '
        + 'need this for diagnostics, mint a token via createStopOnErrorOverrideToken(reason).',
      );
    }
    this._stopOnError = value;
  }

  /**
   * T1-202: register / clear a sink for controller-layer safety events.
   * Production wiring lives in `useControllerConnection.ts`, which
   * forwards each event to `MachineEventLedger.append(...)`. Tests
   * pass a custom sink to assert the emit sites are reached.
   *
   * Idempotent: passing `null` clears the sink. Setting twice replaces
   * the previous reference. The controller does not retain or replay
   * past events for a late-arriving sink — events that fire before
   * the sink is set are lost (matches the existing `console.warn`
   * trace, which never persisted).
   */
  setSafetyEventSink(sink: ControllerSafetyEventSink | null): void {
    this._safetyEventSink = sink;
  }

  /** Bed size, feeds, homing mask, and laser mode from the last $$ dump. */
  getMachineInfo(): GrblMachineInfo {
    return {
      bedWidth: this._bedWidth,
      bedHeight: this._bedHeight,
      homingDir: this._homingDir,
      maxSpindle: this._maxSpindle ?? 0,
      laserMode: this._laserMode,
      maxFeedX: this._maxFeedX,
      maxFeedY: this._maxFeedY,
      maxAccelX: this._maxAccelX,
      maxAccelY: this._maxAccelY,
    };
  }

  /**
   * T1-220 (v30 audit #8): number of job lines this controller has
   * written to the transport since the most recent `sendJob()`
   * call. Consumed by `MachineService.startValidatedJob`'s failed-
   * start carve-out: if a non-zero count is observed at the catch
   * site, machine-affecting output streamed and the unsafe-prior-
   * state flag MUST survive regardless of current `isJobRunning`
   * or controller status (both of which a synchronous
   * `_abortJob()` can clear before the catch reads them).
   *
   * Monotonic during a job; reset to 0 at the start of every
   * `sendJob()`. Never decremented.
   */
  getJobLinesWrittenSinceJobStart(): number {
    return this._jobLinesWrittenSinceJobStart;
  }

  // ─── LIFECYCLE ──────────────────────────────────────────────

  async connect(port: SerialPortLike, signal?: AbortSignal): Promise<void> {
    if (this._port) throw new Error('Already connected. Disconnect first.');
    signal?.throwIfAborted();

    this._maxSpindle = null;
    this._settingsQueried = false;
    this._resetMachineSettingsCache();
    // T3-50: clear captured device identity at connect entry. The probe
    // sends `$I` and the welcome handler captures `[VER:...]` / `[OPT:...]`
    // into these fields. Clearing here covers the case where a previous
    // connect partially failed without going through disconnect.
    this._firmwareVersion = null;
    this._buildOptions = null;
    // T1-44: clear position-confirmed at connect; the welcome handshake's first
    // status report sets it back to true.
    this._positionConfirmed = false;
    // T1-25: clear safe-state tracking at connect entry. _armSafeStateCheck
    // re-initializes _unsafeAtConnect to null and starts the watchdog at
    // welcome-time; clearing here covers the case where a previous connect
    // partially failed without going through disconnect.
    this._safeStateCheckArmed = false;
    if (this._safeStateWatchdog !== null) {
      clearTimeout(this._safeStateWatchdog);
      this._safeStateWatchdog = null;
    }
    this._unsafeAtConnect = null;

    this._port = port;
    const connectionToken = this._connectionGenerations.allocate();
    this._activeConnectionToken = connectionToken;
    this._updateStatus('connecting');

    return new Promise<void>((resolve, reject) => {
      let welcomeReceived = false;
      let connectSettled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let probeI: ReturnType<typeof setTimeout> | undefined;
      let probeSettings: ReturnType<typeof setTimeout> | undefined;
      let probeWifi1: ReturnType<typeof setTimeout> | undefined;
      let probeWifi2: ReturnType<typeof setTimeout> | undefined;
      let probeWifi3: ReturnType<typeof setTimeout> | undefined;

      const clearProbeTimers = (): void => {
        if (probeI !== undefined) clearTimeout(probeI);
        if (probeSettings !== undefined) clearTimeout(probeSettings);
        if (probeWifi1 !== undefined) clearTimeout(probeWifi1);
        if (probeWifi2 !== undefined) clearTimeout(probeWifi2);
        if (probeWifi3 !== undefined) clearTimeout(probeWifi3);
        probeI = undefined;
        probeSettings = undefined;
        probeWifi1 = undefined;
        probeWifi2 = undefined;
        probeWifi3 = undefined;
      };

      const cleanupConnectTimers = (): void => {
        if (timeout !== undefined) {
          clearTimeout(timeout);
          timeout = undefined;
        }
        clearProbeTimers();
      };

      const abortReason = (): Error =>
        signal?.reason instanceof Error ? signal.reason : new Error('Connection aborted by user');

      const onAbort = (): void => {
        if (connectSettled) return;
        connectSettled = true;
        cleanupConnectTimers();
        this._stopStatusPolling();
        if (!isStaleContext(contextFromToken(connectionToken), this._activeConnectionToken)) {
          this._activeConnectionToken = null;
        }
        if (this._port === port) {
          void port.close().catch(() => { /* ignore abort cleanup close failures */ });
          this._port = null;
        }
        this._updateStatus('disconnected');
        reject(abortReason());
      };

      signal?.addEventListener('abort', onAbort, { once: true });

      port.onData(withGenerationGuard(connectionToken, () => this._activeConnectionToken, (line) => {
        if (connectSettled && !welcomeReceived) return;
        this._emitRawLine(line, 'rx');
        this._recordControllerRx();

        // USB: stay quiet until polled; `?` yields `<State|...>`. Only treat lines
        // with a known GRBL state token as welcome — random `<` noise must not connect.
        const statusToken = parseGrblStatusReportStateToken(line);
        const statusWelcome = statusToken != null ? machineStatusFromGrblReportToken(statusToken) : null;
        const isGrblStatusWelcome = statusWelcome != null;

        // T1-51: removed `line === 'ok'` from the welcome predicate. A
        // bare `ok` is too weak — many non-GRBL devices respond `ok` to
        // newlines (modems, industrial controllers, serial loopbacks),
        // stale lines from previous sessions can still be in the
        // kernel/browser buffer at connect time, and a malfunctioning
        // device can spoof the handshake by responding `ok` to any
        // input. The remaining clauses each require GRBL-specific
        // shape: `grbl` banner substring, `$I` version/option blocks,
        // `[MSG:...]` GRBL message, or a `<State|MPos:...>` realtime
        // status line. `[OPT:...]` is added for the same reason —
        // it's the second half of the `$I` response and is unique to
        // GRBL. If a device responds only with `ok` to probes and
        // never produces one of these, the existing overall timeout
        // fires and connect fails with the standard "no welcome"
        // path — far better than the false-positive that produced a
        // "Connected" UI on a non-GRBL port.
        const isWelcome =
          line.toLowerCase().includes('grbl') ||
          line.startsWith('[VER:') ||
          line.startsWith('[OPT:') ||
          line.startsWith('[MSG:') ||
          isGrblStatusWelcome;

        if (!welcomeReceived && isWelcome) {
          connectSettled = true;
          signal?.removeEventListener('abort', onAbort);
          welcomeReceived = true;
          cleanupConnectTimers();
          // Never claim idle if the controller is already in motion (avoids overlapping streams).
          this._updateStatus(statusWelcome ?? 'idle');
          // T1-25: arm the safe-state handshake. The next status report
          // (either a re-process of the welcome status line via the
          // microtask below, or the first periodic poll) will compute
          // `_unsafeAtConnect` from the parsed state. A 5-second
          // watchdog catches the `'no-status-response'` case where
          // status never arrives (wedged firmware, dead cable). The
          // hook clears the watchdog when it fires, so under normal
          // conditions there's no surplus timer cost.
          this._armSafeStateCheck();
          this._startStatusPolling();
          resolve();
          queueMicrotask(() => {
            try {
              if (isGrblStatusWelcome) {
                this._handleLine(line);
              }
              this._queryMachineSettings();
            } catch {
              /* ignore */
            }
          });
          return;
        }

        if (welcomeReceived) {
          this._handleLine(line);
        }
      }));

      probeWifi1 = setTimeout(() => {
        if (!welcomeReceived) {
          try {
            port.write('\n');
          } catch {
            /* ignore */
          }
        }
      }, 1000);
      probeWifi2 = setTimeout(() => {
        if (!welcomeReceived) {
          try {
            port.write('?\n');
          } catch {
            /* ignore */
          }
        }
      }, 2000);
      probeWifi3 = setTimeout(() => {
        if (!welcomeReceived) {
          try {
            port.write('\n');
          } catch {
            /* ignore */
          }
        }
      }, 3000);

      port.onError(withGenerationGuard(connectionToken, () => this._activeConnectionToken, (err) => {
        for (const cb of this._errorListeners) {
          cb(-1, `Serial error: ${err.message}`);
        }
        // T3-2 case 5 / T3-16: a serial transport error during a job is
        // operationally a cable pull. Abort the stream, close the failed
        // handle best-effort, and force disconnected so the UI cannot start
        // another job on a dead port.
        this._handleTransportDisconnect(true);
      }));

      port.onClose(withGenerationGuard(connectionToken, () => this._activeConnectionToken, () => {
        this._handleTransportDisconnect(false);
      }));

      port.write('\n');
      try {
        port.write('?\n');
      } catch {
        /* ignore */
      }
      if (!welcomeReceived) {
        probeI = setTimeout(() => {
          try {
            port.write('$I\n');
          } catch {
            /* ignore */
          }
        }, 500);
        probeSettings = setTimeout(() => {
          try {
            port.write('$$\n');
          } catch {
            /* ignore */
          }
        }, 1000);
        timeout = setTimeout(() => {
          connectSettled = true;
          signal?.removeEventListener('abort', onAbort);
          cleanupConnectTimers();
          this._stopStatusPolling();
          if (!isStaleContext(contextFromToken(connectionToken), this._activeConnectionToken)) {
            this._activeConnectionToken = null;
          }
          if (this._port) {
            // T2-31: close() is now async. setTimeout cannot await; chain
            // .catch to swallow the close-failure (best-effort cleanup,
            // matching the pre-T2-31 try/catch shape). The reject below
            // races the close — that's intentional: the connection-
            // timeout error is the load-bearing signal, not the close
            // outcome.
            void this._port.close().catch(() => { /* ignore */ });
            this._port = null;
          }
          this._updateStatus('disconnected');
          reject(new Error('Connection timeout — no GRBL welcome message'));
        }, 10_000);
      }
    });
  }

  async disconnect(): Promise<void> {
    this._stopStatusPolling();
    this._abortJob();
    if (this._port?.isOpen) {
      // Safety: pause motion and turn laser off before closing port.
      // Uses feed hold (not soft reset) to preserve machine position.
      // Without this, closing port while in M3 mode leaves the laser on.
      try {
        this._sendRealtime(REALTIME_FEED_HOLD);
        await new Promise(r => setTimeout(r, 50));
        this._port.write('M5 S0\n');
        this._emitRawLine('M5 S0', 'tx', 'user');
      } catch {
        // Best effort — port may already be closing or in error state
      }
      await new Promise(r => setTimeout(r, 80));
      this._activeConnectionToken = null;
      try {
        // T2-31: close() is now async. Await so disconnect resolves only
        // after the browser has released the port — eliminates the race
        // where a fast reconnect-after-disconnect saw the old handle
        // still being closed.
        await this._port.close();
      } catch {
        // Port may have closed from the other side
      }
      this._port = null;
    } else if (this._port) {
      this._port = null;
    }
    this._activeConnectionToken = null;
    this._maxSpindle = null;
    this._settingsQueried = false;
    this._awaitingSettingsOk = false;
    this._awaitingIdentityOk = false;
    this._awaitingWcsQueryOk = false;
    this._finishWorkOffsetRequest(null);
    this._currentG54 = null;
    // T3-50: clear identity snapshot so a future reconnect surfaces the
    // newly-attached device's identity, not the previous session's.
    this._firmwareVersion = null;
    this._buildOptions = null;
    // T1-20: nothing to be uncertain about when not connected.
    this._placementUncertain = false;
    this._lastPlacementUncertainReason = null;
    // T1-44: position is no longer trustworthy after disconnect; relative-mode
    // bounds checks must wait for a fresh status report before accepting jobs.
    this._positionConfirmed = false;
    // T1-25: clear safe-state-at-connect tracking. The next connect re-arms
    // the watchdog and re-runs the first-status verdict from scratch.
    this._safeStateCheckArmed = false;
    if (this._safeStateWatchdog !== null) {
      clearTimeout(this._safeStateWatchdog);
      this._safeStateWatchdog = null;
    }
    this._unsafeAtConnect = null;
    this._grblSettings.clear();
    this._resetMachineSettingsCache();
    this._updateStatus('disconnected');
  }

  // ─── JOB EXECUTION ──────────────────────────────────────────

  private _handleTransportDisconnect(closePort: boolean): void {
    const port = this._port;
    this._stopStatusPolling();
    this._abortJob();
    this._port = null;
    this._activeConnectionToken = null;
    this._maxSpindle = null;
    this._settingsQueried = false;
    this._awaitingSettingsOk = false;
    this._awaitingIdentityOk = false;
    this._awaitingWcsQueryOk = false;
    this._finishWorkOffsetRequest(null);
    this._currentG54 = null;
    // T3-50: clear identity snapshot on transport-error disconnect.
    this._firmwareVersion = null;
    this._buildOptions = null;
    this._placementUncertain = false;
    this._lastPlacementUncertainReason = null;
    this._positionConfirmed = false;
    this._safeStateCheckArmed = false;
    if (this._safeStateWatchdog !== null) {
      clearTimeout(this._safeStateWatchdog);
      this._safeStateWatchdog = null;
    }
    this._unsafeAtConnect = null;
    this._grblSettings.clear();
    this._resetMachineSettingsCache();
    this._updateStatus('disconnected');
    if (closePort && port?.isOpen) {
      void port.close().catch(() => { /* ignore transport-error cleanup close failures */ });
    }
  }

  async executeJob(output: ControllerOutput, ticket: ControllerJobTicket): Promise<JobHandle> {
    if (output.kind !== 'gcode-lines' && output.kind !== 'gcode-stream') {
      throw new Error(`GRBL controller only supports gcode-lines or gcode-stream output, got ${output.kind}`);
    }
    if (output.dialect !== 'grbl') {
      throw new Error(`GRBL controller cannot execute ${output.dialect} dialect; expected grbl`);
    }
    if (output.kind === 'gcode-stream') {
      await this.sendJobSpool(output.spool);
    } else {
      await this.sendJob([...output.lines]);
    }
    return {
      id: ticket.ticketId,
      startedAt: Date.now(),
    };
  }

  async sendJob(lines: string[]): Promise<void> {
    if (!this._port?.isOpen) throw new Error('Not connected');
    if (this._isJobRunning) throw new Error('Job already running');

    const freshStatus = await this._queryFreshStatus();
    if (freshStatus !== 'idle') {
      throw new Error(
        `Cannot start job — machine is "${freshStatus}" (wait for idle, then try again)`,
      );
    }

    const { jobLines, lineMarkers } = this._parseJobLines(lines);

    const boundsError = this._checkJobBounds(jobLines);
    if (boundsError) {
      throw new Error(boundsError);
    }

    this._startPreparedJob(jobLines, lineMarkers);
  }

  private async sendJobSpool(spool: SpoolHandle): Promise<void> {
    if (!this._port?.isOpen) throw new Error('Not connected');
    if (this._isJobRunning) throw new Error('Job already running');

    const freshStatus = await this._queryFreshStatus();
    if (freshStatus !== 'idle') {
      throw new Error(
        `Cannot start job — machine is "${freshStatus}" (wait for idle, then try again)`,
      );
    }

    const totalJobLines = await this._validateSpoolBeforeStreaming(spool);

    this._streamIterator = spool.open()[Symbol.asyncIterator]();
    this._streamParserState = createGrblJobLineParserState();
    this._streamDone = false;
    this._streamFillInFlight = false;
    this._jobLines = [];
    this._lineMarkers = [];
    this._resetJobRuntime(totalJobLines);

    await this._fillStreamWindow();
    if (this._jobLines.length === 0 && this._streamDone) {
      this._clearStreamState();
      this._emitProgress();
      return;
    }

    this._isJobRunning = true;
    this._updateStatus('run');
    this._emitProgress();
    this._drainQueue();
  }

  private async _validateSpoolBeforeStreaming(spool: SpoolHandle): Promise<number> {
    const parserState = createGrblJobLineParserState();
    const boundsContext = this._jobBoundsContext();
    const boundsState = createGrblJobBoundsState(boundsContext);
    let sawLast = false;
    let totalJobLines = 0;
    for await (const chunk of spool.open()) {
      const parsed = parseGrblJobLineChunk(chunk.lines, parserState);
      const boundsError = checkGrblJobBoundsChunk(parsed.jobLines, boundsContext, boundsState);
      if (boundsError) {
        throw new Error(boundsError);
      }
      totalJobLines += parsed.jobLines.length;
      if (chunk.isLast) {
        sawLast = true;
        break;
      }
    }

    if (!sawLast) {
      throw new Error('Streaming G-code ended before terminal chunk.');
    }

    return totalJobLines;
  }

  private async _fillStreamWindow(): Promise<void> {
    if (this._streamIterator === null || this._streamParserState === null || this._streamDone) {
      return;
    }
    if (this._streamFillInFlight) return;

    this._streamFillInFlight = true;
    try {
      while (this._jobLines.length < STREAM_JOB_WINDOW_LINES && !this._streamDone) {
        const next = await this._streamIterator.next();
        if (next.done) {
          this._streamDone = true;
          break;
        }
        const chunk = next.value;
        const parsed = parseGrblJobLineChunk(chunk.lines, this._streamParserState);
        this._jobLines.push(...parsed.jobLines);
        this._lineMarkers.push(...parsed.lineMarkers);
        if (chunk.isLast) {
          this._streamDone = true;
          break;
        }
      }
    } finally {
      this._streamFillInFlight = false;
    }
  }

  private _handleStreamFillError(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    for (const cb of this._errorListeners) {
      cb(0, `GRBL stream fill failed: ${message}`);
    }
    this._abortJob();
    this._emitProgress();
  }

  private _startPreparedJob(
    jobLines: string[],
    lineMarkers: (readonly string[] | null)[],
  ): void {
    this._jobLines = jobLines;
    this._lineMarkers = lineMarkers;
    this._clearStreamState();
    this._resetJobRuntime(jobLines.length);

    // No lines to stream — never set _isJobRunning or we never get 'ok' and manual sendCommand stays blocked forever
    if (this._jobLines.length === 0) {
      this._lineMarkers = [];
      this._emitProgress();
      return;
    }

    this._isJobRunning = true;
    this._updateStatus('run');
    this._emitProgress();
    this._drainQueue();
  }

  private _resetJobRuntime(totalLines: number): void {
    this._queueIndex = 0;
    this._pending = [];
    this._bufferAvailable = GRBL_BUFFER_SIZE;
    this._linesAcknowledged = 0;
    this._jobTotalLines = totalLines;
    this._jobStartTime = Date.now();
    this._lastControllerRxAt = this._jobStartTime;
    this._jobStatusHeartbeatWarned = false;
    this._pausePending = false;
    this._resumeRequested = false;
    this._ackTimestamps = [];
    this._sendTimestamps = [];
    // T1-220: reset the bytes-written counter at the start of every
    // new job so a stale value from a previous job can't influence
    // the failed-start carve-out.
    this._jobLinesWrittenSinceJobStart = 0;

    this._lastLifecycleKey = null;
    this._emitObjectLifecycle([]);
  }

  private _clearStreamState(): void {
    this._streamIterator = null;
    this._streamParserState = null;
    this._streamDone = false;
    this._streamFillInFlight = false;
  }

  // T1-134: delegates to the pure parseGrblJobLines helper. The parser
  // module owns the grammar (`; OBJ ids=...` comment markers); this
  // method exists only to satisfy callers that previously held the
  // private-method reference.
  private _parseJobLines(lines: string[]): {
    jobLines: string[];
    lineMarkers: (readonly string[] | null)[];
  } {
    return parseGrblJobLines(lines);
  }

  /**
   * Scan job lines for G0/G1 X/Y moves that exceed the controller's known bed
   * extents. Returns null on pass, error string on fail.
   *
   * T1-108: all lines are inspected. This is deliberately O(n): silently
   * accepting an out-of-bounds move after an arbitrary cap is worse than
   * refusing slowly.
   *
   * T1-44: relative-mode (G91) lines are simulated from the controller's
   * current head position (`_state.position`) instead of being skipped.
   * Pre-T1-44 the relative branch was a no-op — current/head-mode jobs got
   * zero bounds protection at the controller layer. Now both modes accumulate
   * a simulated cursor and check it against `_bedWidth` / `_bedHeight`.
   *
   * If a relative move is encountered before any status report has populated
   * `_state.position` (`_positionConfirmed === false`), the job is refused —
   * the (0,0,0) constructor default is indistinguishable from "actually at
   * origin," and a wrong assumption can place the head off-bed. The user is
   * told to reconnect.
   */
  // T1-139: delegates to the pure checkGrblJobBounds helper. The
  // checker owns the EPS tolerance, the G90/G91 mode tracking, and
  // the position-confirmed gate for relative-mode jobs; this method
  // wires the controller's runtime state (bed extents, head position,
  // confirmation flag) into the helper's input shape.
  private _checkJobBounds(lines: string[]): string | null {
    return checkGrblJobBounds(lines, this._jobBoundsContext());
  }

  private _jobBoundsContext(): GrblJobBoundsContext {
    return {
      bedWidthMm: this._bedWidth,
      bedHeightMm: this._bedHeight,
      headPosition: { x: this._state.position.x, y: this._state.position.y },
      positionConfirmed: this._positionConfirmed,
    };
  }

  /**
   * Send `?` and await the next status report. Returns the fresh `state.status`
   * (after the report is parsed). Resolves to `'unknown'` on timeout.
   */
  private async _queryFreshStatus(): Promise<MachineStatus | 'unknown' | 'disconnected'> {
    if (!this._port?.isOpen) return 'disconnected';
    return await new Promise<MachineStatus | 'unknown' | 'disconnected'>((resolve) => {
      let settled = false;
      let unsub: () => void = () => {};

      const done = (s: MachineStatus | 'unknown' | 'disconnected') => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsub();
        resolve(s);
      };

      const timer = setTimeout(() => done('unknown'), 500);

      unsub = this.onRawLine((line, direction) => {
        if (direction !== 'rx' || !line.startsWith('<') || !line.endsWith('>')) return;
        queueMicrotask(() => {
          if (settled) return;
          done(this._state.status);
        });
      });
      try {
        this._sendRealtime(REALTIME_STATUS);
      } catch {
        done('disconnected');
      }
    });
  }

  /**
   * Feed-hold pause. Machine decelerates cleanly, preserves position, laser turns off.
   * Recoverable via resume(). Send this for user-initiated pause during a job.
   */
  async pause(): Promise<SafetyActionResult> {
    if (!this._port?.isOpen) return makeNotConnectedResult('pause');
    console.info('[GrblController] pause() — feed hold (recoverable)');
    if (this._isJobRunning) {
      this._pausePending = true;
      this._resumeRequested = false;
      this._state.status = 'hold';
    }
    // T1-23: feed-hold halts motion first, then M5 clears modal laser
    // state as belt-and-suspenders for $32=0 or non-spec GRBL forks.
    this._sendRealtime(REALTIME_FEED_HOLD);
    if (this._port?.isOpen) {
      try {
        await this._writeCriticalSystemLine('M5 S0', { trackSpindleMode: false });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          '[GrblController] T1-252 pause: M5 writeCritical failed after feed-hold; '
          + 'reporting laser-off as unknown instead of returning a clean pause:',
          message,
        );
        return makePauseResult({
          accepted: false,
          motionState: 'unknown',
          laserState: 'unknown',
          positionTrusted: 'unknown',
          requiresRehome: 'unknown',
          requiresReconnect: false,
          requiresInspection: true,
          message:
            'Pause feed-hold was sent, but the M5 S0 laser-off confirmation failed. '
            + `Inspect the machine before continuing. Underlying error: ${message}`,
        });
      }
    }
    return makePauseResult({
      laserState: 'off',
      message: 'Pause command accepted. Feed-hold sent and M5 S0 laser-off confirmed on the wire.',
    });
  }

  /**
   * Resume a feed-hold pause. Only meaningful after pause().
   */
  async resume(): Promise<SafetyActionResult> {
    if (!this._port?.isOpen) return makeNotConnectedResult('resume');
    if (this._state.status !== 'hold' && !this._pausePending) {
      return {
        action: 'resume',
        accepted: false,
        motionState: this._state.status === 'run' ? 'running' : 'unknown',
        laserState: 'unknown',
        positionTrusted: 'unknown',
        requiresRehome: 'unknown',
        requiresReconnect: false,
        requiresInspection: false,
        message: 'Resume ignored because the controller is not paused.',
        timestamp: Date.now(),
      };
    }
    // T1-23: pause() emitted M5. Reassert the captured modal spindle
    // mode with S0 before cycle-start so the resumed stream has the
    // expected M3/M4 mode without firing before motion resumes.
    //
    // T1-216 (v30 audit #3): pre-T1-216 the modal reassert was
    // fire-and-forget (`void ... .catch(...)`) and the cycle-start
    // byte was issued synchronously on the next line. If the modal
    // write FAILED (transport closed, queue full, dropped line),
    // motion resumed with whatever modal state GRBL happened to
    // have — not the safe `M3 S0` / `M4 S0` the resume contract
    // promised. Awaiting the write makes resume a transaction:
    // motion does NOT restart until the modal contract is
    // confirmed on the wire. On write failure we return
    // `accepted: false` and skip the cycle-start byte entirely so
    // the controller stays in feed-hold.
    if (this._lastSpindleMode && this._port?.isOpen) {
      const mode = this._lastSpindleMode;
      try {
        await this._writeCriticalSystemLine(`${mode} S0`, { trackSpindleMode: false });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          '[GrblController] T1-216 resume: spindle-mode reassert writeCritical failed; '
          + 'NOT sending cycle-start. Controller remains in feed-hold:',
          message,
        );
        return {
          action: 'resume',
          accepted: false,
          motionState: 'unknown',
          laserState: 'unknown',
          positionTrusted: 'unknown',
          requiresRehome: 'unknown',
          requiresReconnect: false,
          requiresInspection: false,
          message:
            `Resume blocked: spindle-mode reassert (${mode} S0) failed before cycle-start. `
            + 'Motion did NOT restart — the controller remains in feed-hold. '
            + `Underlying error: ${message}`,
          timestamp: Date.now(),
        };
      }
    }
    // Realtime `~` releases GRBL feed-hold; only continues streaming when a job is active.
    console.info('[GrblController] feed-hold release (~ / cycle-start)');
    this._sendRealtime(REALTIME_CYCLE_START);
    if (!this._isJobRunning) return makeResumeResult();
    this._resumeRequested = true;
    this._pausePending = false;
    this._state.status = 'run';
    this._drainQueue();
    return makeResumeResult();
  }

  /**
   * Stop the current job and halt motion immediately.
   *
   * Uses GRBL soft reset (0x18), which purges the planner buffer
   * and stops all motion within the current deceleration cycle.
   * M5 is not useful here because GRBL does not execute M5 as a
   * realtime command — a queued M5 will not fire until every move
   * already in the planner has executed. Soft reset is the only way
   * to stop motion + laser immediately on a real GRBL machine.
   *
   * After stop() the machine may enter ALARM state and will
   * require $X to unlock plus $H to re-home before running another
   * job. This is GRBL's designed post-reset behavior — do not
   * auto-unlock here. The operator should inspect the machine.
   *
   * For a pause/resume that preserves position, use pause() +
   * resume() (feed-hold / cycle-start).
   */
  stop(): SafetyActionResult {
    if (!this._port?.isOpen) return makeNotConnectedResult('abortJob');
    console.info('[GrblController] stop() — soft reset, job aborted, re-home required');
    this._sendRealtime(REALTIME_RESET);
    this._abortJob();
    this._emitProgress();
    return makeSoftResetStopResult();
  }

  /**
   * Emergency stop: soft reset + disconnect. Severs the command path so no further
   * commands can reach the machine without explicit reconnect.
   *
   * Use only for physical danger — fire, crash, runaway, user injury. For ordinary
   * "stop this job" use stop() instead.
   */
  emergencyStop(): SafetyActionResult {
    if (!this._port?.isOpen) return makeNotConnectedResult('emergencyStop');
    console.warn(
      '[GrblController] EMERGENCY STOP — soft reset, position may be lost, rehome may be required. Disconnecting.',
    );
    this._sendRealtime(REALTIME_RESET);
    this._abortJob();
    this._emitProgress();
    // Sever the command path. User must reconnect to send anything further.
    void this.disconnect().catch((err: unknown) => {
      console.warn(
        '[GrblController] Emergency disconnect failed (port may already be closed):',
        err,
      );
    });
    return makeEmergencyStopResult();
  }

  /**
   * Two-stage hardware-off path. T1-22.
   *
   * Stage 1: try `M5 S0` via the port's awaitable critical-write path. If
   * transport accepts it, return `{ stage: 'm5' }`. The caller can trust the
   * laser-off intent reached firmware.
   *
   * Stage 2 (only if Stage 1 rejects): fall back to soft reset (`0x18`) via
   * the awaitable critical-byte path. Soft reset is GRBL's actual realtime
   * emergency stop; it disables laser output at firmware level but is
   * destructive (loses position, may require re-home depending on `$22`).
   * On success returns `{ stage: 'soft-reset', error: <m5_error> }`. The
   * controller's internal job state is also aborted.
   *
   * If both fail (or port is closed), returns `{ stage: 'failed', error }`.
   * Never throws — the caller (`ExecutionCoordinator.emergencyLaserOff`) is on
   * the safety hot path and must always get a structured outcome it can act on.
   */
  async safetyOff(): Promise<SafetyOffResult> {
    if (!this._port?.isOpen) {
      return { stage: 'failed', error: new Error('Not connected') };
    }
    let m5Error: Error | undefined;
    try {
      await this._port.writeCritical('M5 S0\n');
      this._emitRawLine('M5 S0', 'tx', 'system');
      return { stage: 'm5' };
    } catch (err) {
      m5Error = err instanceof Error ? err : new Error(String(err));
    }
    // Stage 2: soft reset. Tighter guarantee but destructive.
    try {
      if (!this._port?.isOpen) {
        return { stage: 'failed', error: m5Error };
      }
      await this._port.writeByteCritical(REALTIME_RESET);
      // Mirror the bookkeeping of stop()/emergencyStop() so internal state is
      // consistent after a forced reset.
      this._abortJob();
      this._emitProgress();
      return { stage: 'soft-reset', error: m5Error };
    } catch (resetErr) {
      const resetError = resetErr instanceof Error ? resetErr : new Error(String(resetErr));
      // Combine both error messages so support bundles capture the full picture.
      const combined = new Error(
        `M5 failed (${m5Error?.message ?? 'unknown'}); soft reset also failed (${resetError.message})`,
      );
      return { stage: 'failed', error: combined };
    }
  }

  private _emitSafetyOffOutcome(outcome: SafetyOffOutcome): void {
    for (const cb of this._safetyOffOutcomeListeners) {
      try {
        cb(outcome);
      } catch (err) {
        console.warn('[GrblController] safety-off outcome listener failed:', err);
      }
    }
  }

  private async _runControllerOwnedSafetyOff(
    source: SafetyOffOutcomeSource,
    code?: number,
  ): Promise<SafetyOffResult> {
    let result: SafetyOffResult;
    try {
      result = await this.safetyOff();
    } catch (err: unknown) {
      result = {
        stage: 'failed',
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
    const outcome: SafetyOffOutcome = {
      source,
      stage: result.stage,
    };
    if (result.error != null) outcome.error = result.error;
    if (code != null) outcome.code = code;
    this._emitSafetyOffOutcome(outcome);
    return result;
  }

  private async _buildAutoFocusSafetyOffError(message: string): Promise<AutoFocusSafetyOffError> {
    let result: SafetyOffResult;
    try {
      result = await this.safetyOff();
    } catch (err: unknown) {
      result = {
        stage: 'failed',
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
    return new AutoFocusSafetyOffError(message, result);
  }

  /**
   * T2-12 part 2: clear a 'faulted_requires_inspection' state and
   * return the controller to 'idle'. Should only be called after the
   * user has physically inspected the machine.
   *
   * Behavior:
   *   - If the controller is in 'faulted_requires_inspection': fire
   *     safetyOff() as defense-in-depth (laser-off invariant; the
   *     original fault path already invoked it once but it's cheap
   *     and idempotent), then transition status to 'idle'. Returns
   *     { ok: true }.
   *   - If the controller is in any other state: no-op. Returns
   *     { ok: true }. Idempotent so the UI can call it without
   *     reading status first.
   *   - If not connected: returns { ok: false, reason: 'Not connected' }.
   *
   * Never throws.
   */
  async acknowledgeFault(): Promise<{ ok: boolean; reason?: string }> {
    if (!this._port?.isOpen) {
      return { ok: false, reason: 'Not connected' };
    }
    if (this._state.status !== 'faulted_requires_inspection') {
      // Idempotent — nothing to clear.
      return { ok: true };
    }
    // T1-217 (v30 audit #2): await the safety-off and only flip out
    // of the fault state when the laser-off contract actually
    // succeeded. Pre-T1-217 the safetyOff() promise was fire-and-
    // forget (`void this.safetyOff().then(...).catch(...)`) and the
    // status was flipped to 'idle' synchronously on the next line —
    // so if BOTH the fault-time safetyOff AND this defense-in-depth
    // safetyOff failed, the controller reported idle to the UI
    // without any enforcement that the laser was actually off.
    //
    // New behaviour:
    //   - safetyOff() returns 'm5'         → laser commanded off via
    //     M5 S0. Clear fault, flip to idle.
    //   - safetyOff() returns 'soft-reset' → M5 failed but soft
    //     reset succeeded. GRBL is forcibly halted; laser is off
    //     because the controller was reset. Clear fault, flip to
    //     idle.
    //   - safetyOff() returns 'failed'     → BOTH M5 and soft reset
    //     failed. Laser-off contract is indeterminate. Stay in the
    //     faulted state and surface the error to the caller. UI
    //     already renders `result.ok === false` (see
    //     ConnectionPanelMain.handleAcknowledgeFault).
    const result = await this.safetyOff();
    if (result.stage === 'failed') {
      const msg = result.error?.message ?? 'safetyOff returned failed';
      console.warn(
        '[GrblController] T1-217: safetyOff during acknowledgeFault failed; '
        + 'NOT clearing fault state. Laser-off contract is indeterminate:',
        msg,
      );
      return {
        ok: false,
        reason:
          `Cannot clear fault: laser-off failed (${msg}). `
          + 'Disconnect, power-cycle the controller, and reconnect '
          + 'before resuming. Use the physical E-stop or power '
          + 'disconnect first if the laser may still be active.',
      };
    }
    if (result.stage === 'soft-reset') {
      console.warn(
        '[GrblController] T1-217: safetyOff during acknowledgeFault took the '
        + 'soft-reset fallback. M5 critical-write failed; controller was '
        + 'force-reset. Position is lost; rehome required before next job.',
      );
    }
    this._state.errorCode = null;
    this._updateStatus('idle');
    return { ok: true };
  }

  // ─── MANUAL CONTROL ─────────────────────────────────────────

  /**
   * `source` is reserved (audit / future enforcement); the controller only
   * enforces line shape and job-stream rules.
   */
  sendCommand(command: string, _source: 'internal' | 'user' = 'internal'): void {
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

  private _operationError(err: unknown): OperationResult {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  private _operationFromSafetyResult(result: SafetyActionResult): OperationResult {
    if (result.accepted) {
      return { ok: true, message: result.message, safetyResult: result };
    }
    return {
      ok: false,
      reason: result.message ?? `${result.action} not accepted`,
      message: result.message,
      safetyResult: result,
    };
  }

  private _trySendInternalOperationCommand(command: string, onCommand?: (line: string) => void): OperationResult {
    try {
      this.sendCommand(command, 'internal');
      onCommand?.(command);
      return { ok: true };
    } catch (err: unknown) {
      return this._operationError(err);
    }
  }

  requestStatusReport(): void {
    if (!this._port?.isOpen) return;
    this._sendRealtime(REALTIME_STATUS);
  }

  private _controllerSetupInProgress(): boolean {
    return this._awaitingIdentityOk ||
      this._awaitingSettingsOk ||
      this._awaitingWcsQueryOk ||
      this._awaitingWorkOffsetRequestOk;
  }

  /**
   * Trigger a machine autofocus macro/command and wait for a full motion cycle.
   * Resolves only after the machine leaves Idle (Home/Run) and then returns to Idle.
   */
  async runAutoFocus(command: string, timeoutMs: number = 15000): Promise<void> {
    if (!this._port?.isOpen) throw new Error('Not connected');
    if (this._state.status !== 'idle') throw new Error('Machine not idle — cannot auto-focus');
    if (this._controllerSetupInProgress()) {
      throw new Error('Controller setup still in progress — wait a moment, then try autofocus again');
    }
    if (typeof command !== 'string' || command.length === 0) {
      throw new Error('Invalid autofocus command: empty');
    }
    if (command.length > 127) {
      throw new Error('Autofocus command exceeds GRBL buffer size (127 bytes)');
    }
    if (/[\r\n]/.test(command)) {
      throw new Error('Autofocus command must be single-line');
    }

    return await new Promise<void>((resolve, reject) => {
      let completed = false;
      let commandSent = false;
      let commandAcknowledged = false;
      let sawActiveState = false;
      let unsubState: Unsubscribe = () => {};
      let unsubRaw: Unsubscribe = () => {};
      // T1-28: timeout and alarm paths must trigger safety-off before
      // rejecting. Autofocus moves the Z-axis against a probe; if the
      // firmware hangs (probe pin floating, Z-stage stuck, mechanical
      // interference) or alarms mid-probe, the head may be pressing
      // into the workpiece while the laser is in M3/M4 modal state
      // from a previous operation. Rejecting without firing M5 / soft
      // reset leaves the machine in an undefined state. T1-22's
      // safetyOff handles M5-then-soft-reset fallback.
      //
      // Defense-in-depth: if safetyOff itself rejects (transport
      // failure, port closed), the catch swallows it so the original
      // timeout / alarm error reaches the caller — masking the
      // primary cause is worse than the secondary failure.
      const timer = setTimeout(() => {
        cleanup();
        void this._buildAutoFocusSafetyOffError(
          'Auto-focus timed out - safety-off attempted',
        ).then(reject);
      }, timeoutMs);

      const cleanup = (): void => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        unsubState();
        unsubRaw();
      };

      const resolveSuccess = (): void => {
        cleanup();
        resolve();
      };

      unsubState = this.onStateChange((next) => {
        if (next.status === 'alarm') {
          cleanup();
          // T1-28: alarm during autofocus → safety-off before reject.
          void this._buildAutoFocusSafetyOffError(
            `Auto-focus alarm: ALARM:${next.alarmCode ?? 'unknown'} - safety-off attempted`,
          ).then(reject);
          return;
        }
        if (next.status === 'homing' || next.status === 'run') {
          sawActiveState = true;
          return;
        }
        if ((sawActiveState || commandAcknowledged) && next.status === 'idle') {
          resolveSuccess();
        }
      });
      unsubRaw = this.onRawLine((line, direction) => {
        if (direction !== 'rx') return;
        if (commandSent && line === 'ok') {
          commandAcknowledged = true;
          try {
            this.requestStatusReport();
          } catch {
            /* timeout path will surface disconnected/stale ports */
          }
          return;
        }
        if (commandSent && line.startsWith('error:')) {
          cleanup();
          reject(new Error(`Autofocus command rejected: ${line}`));
          return;
        }
        if (!(line.startsWith('<') && line.endsWith('>'))) return;
        const token = line.slice(1, -1).split('|')[0]?.toLowerCase() ?? '';
        // Falcon firmware can emit non-standard states during $HZ1; treat any
        // non-idle/non-alarm status token as active so success doesn't false-timeout.
        if (token.length > 0 && token !== 'idle' && !token.startsWith('alarm')) {
          sawActiveState = true;
          return;
        }
        // Some Falcon firmwares acknowledge $HZ1 and only report Idle after
        // the internal focus cycle completes, without exposing a distinct
        // Run/Home/Focus status. Treat ack + post-command Idle as success so
        // a physically successful autofocus does not surface a false failure.
        if (commandAcknowledged && token === 'idle') {
          resolveSuccess();
        }
      });

      try {
        this._writeLine(command);
        commandSent = true;
        this.requestStatusReport();
      } catch (err: unknown) {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
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

  onSafetyOffOutcome(callback: SafetyOffOutcomeCallback): Unsubscribe {
    this._safetyOffOutcomeListeners.add(callback);
    return () => this._safetyOffOutcomeListeners.delete(callback);
  }

  onObjectLifecycle(cb: ObjectLifecycleCallback): Unsubscribe {
    this._objectLifecycleListeners.add(cb);
    return () => this._objectLifecycleListeners.delete(cb);
  }

  onWcsConsentNeeded(callback: (state: WcsConsentSnapshot) => void): Unsubscribe {
    this._wcsConsentListeners.add(callback);
    return () => this._wcsConsentListeners.delete(callback);
  }

  getCurrentWcsState(): { g54: { x: number; y: number; z: number } | null; statusMask: number | null } {
    const mask = this._grblSettings.get(10);
    const m = mask != null ? parseInt(mask, 10) : NaN;
    return {
      g54: this._currentG54,
      statusMask: Number.isFinite(m) ? m : null,
    };
  }

  /**
   * Apply the LaserForge-standard WCS and status-report mask. Call after user consent
   * (or when the machine was already in the baseline state and no prompt was needed).
   */
  applyWcsNormalization(): void {
    if (!this._port?.isOpen) return;
    this._writeSystemLine('G10 L2 P1 X0 Y0 Z0');
    this._writeSystemLine('$10=0');
    this._settingsQueried = true;
    // T1-20: applying normalization brings the machine to the
    // LaserForge-standard baseline. Whether we got here via consent,
    // via the headless flag, or via the auto-apply-when-already-baseline
    // path in _emitWcsConsentNeeded, the placement question is now
    // resolved.
    this._placementUncertain = false;
    this._lastPlacementUncertainReason = null;
    appendStructuredDiagnosticLogEvent({
      domain: 'controller',
      event: 'grbl-wcs-normalized',
      message: 'GRBL machine baseline resolved.',
      details: {
        bedWidth: this._bedWidth,
        bedHeight: this._bedHeight,
        homingDir: this._homingDir,
        laserMode: this._laserMode,
      },
    });
    for (const cb of this._stateListeners) {
      cb({ ...this._state });
    }
  }

  /** Mark the post-connect settings handshake done without writing G10 / $10. */
  skipWcsNormalization(): void {
    this._settingsQueried = true;
    // T1-20: user (or test) explicitly opted to leave the machine's
    // existing WCS / mask state in place. They've made the decision -
    // placement is no longer uncertain from the controller's POV.
    this._placementUncertain = false;
    this._lastPlacementUncertainReason = null;
    for (const cb of this._stateListeners) {
      cb({ ...this._state });
    }
  }

  /**
   * T1-127: WCS-line parsing now lives in `GrblWcsParser.ts`. This
   * method is the side-effect shell — it stores the parsed offset
   * in `_currentG54`. Behavior is byte-identical: malformed lines
   * (NaN coordinates) leave `_currentG54` unchanged exactly as
   * pre-T1-127 (T1-117's fail-closed WCS path depends on this).
   */
  private _tryParseG54WcsLine(line: string): void {
    const parsed = parseGrblG54WcsLine(line);
    if (parsed === null) return;
    this._currentG54 = { x: parsed.x, y: parsed.y, z: parsed.z };
  }

  /**
   * T1-41: query GRBL for work-coordinate offsets via `$#` and resolve
   * with the freshly-parsed G54. Used by saved-origin verification at
   * Set Origin (snapshot) and at job start (compare). Returns `null`
   * if the controller is disconnected or the response did not parse
   * within the timeout.
   *
   * Implementation: clear `_currentG54` (tombstone), send `$#`, parse the
   * next `[G54:x,y,z]`, then resolve when GRBL sends the trailing `ok`.
   * This is intentionally separate from the startup WCS-consent query.
   */
  async requestWorkOffsets(timeoutMs = 1000): Promise<{ x: number; y: number; z: number } | null> {
    if (!this._port?.isOpen) return null;
    if (this._awaitingWcsQueryOk) return null;
    this._finishWorkOffsetRequest(null);
    this._currentG54 = null;
    return new Promise<{ x: number; y: number; z: number } | null>((resolve) => {
      this._awaitingWorkOffsetRequestOk = true;
      this._workOffsetRequestResolve = resolve;
      this._workOffsetRequestTimer = setTimeout(() => {
        this._finishWorkOffsetRequest(null);
      }, Math.max(0, timeoutMs));
      this._writeSystemLine('$#');
    });
  }

  private _finishWorkOffsetRequest(g54: { x: number; y: number; z: number } | null): void {
    const resolve = this._workOffsetRequestResolve;
    if (this._workOffsetRequestTimer !== null) {
      clearTimeout(this._workOffsetRequestTimer);
      this._workOffsetRequestTimer = null;
    }
    this._awaitingWorkOffsetRequestOk = false;
    this._workOffsetRequestResolve = null;
    if (resolve) resolve(g54 ? { ...g54 } : null);
  }

  private _onSettingsDollarOk(): void {
    if (!this._awaitingSettingsOk) return;
    this._awaitingSettingsOk = false;
    if (!this._port?.isOpen) return;
    this._queryWcsOffsets();
  }

  private _queryWcsOffsets(): void {
    if (!this._port?.isOpen) return;
    this._currentG54 = null;
    this._awaitingWcsQueryOk = true;
    this._writeSystemLine('$#');
  }

  private _onWcsQueryOk(): void {
    this._awaitingWcsQueryOk = false;
    this._emitWcsConsentNeeded();
  }

  private _emitWcsConsentNeeded(): void {
    // T1-117: pre-fix this method conflated "verified zero" with
    // "unknown, defaulted to zero". The pattern was:
    //
    //   parsed = maskRaw != null ? parseInt(maskRaw, 10) : 0;
    //   mask = Number.isFinite(parsed) ? parsed : 0;
    //   g54IsZero = g54 ? <approx-zero check> : true;
    //
    // i.e. a missing $10 setting → mask=0; malformed parse → mask=0;
    // missing/malformed [G54:...] line (so this._currentG54 === null
    // because _tryParseG54WcsLine only assigns when every coordinate
    // is finite) → g54IsZero=true. Combined: any unknown defaults to
    // "looks like baseline" and the controller silently
    // applyWcsNormalization()'d without user consent, normalizing
    // a real machine WCS the user may have wanted to preserve.
    //
    // Now: verified-zero requires BOTH explicit reads. Anything that
    // can't be classified as verified-zero or verified-nonzero is
    // treated as unknown → fail closed: mark _placementUncertain so
    // the start-job gate refuses motion, and do NOT call
    // applyWcsNormalization. Recovery is the same disconnect →
    // reconnect → consent flow that T1-20 introduced for the
    // nonzero-without-listener case.
    const g54 = this._currentG54;
    const maskRaw = this._grblSettings.get(10);
    const verdict = classifyWcsConsentInputs(g54, maskRaw ?? null);

    if (verdict.kind === 'verified-zero') {
      this.applyWcsNormalization();
      return;
    }

    if (verdict.kind === 'unknown') {
      console.warn(
        `[GrblController] T1-117: WCS state unknown after $# (reason: ${verdict.reason}). `
        + 'Refusing to auto-apply WCS normalization. Job start blocked until the user '
        + 'disconnects, addresses the underlying state, and reconnects.',
      );
      this._placementUncertain = true;
      this._lastPlacementUncertainReason = verdict.reason;
      // T1-202: forward to the injected safety-event sink so the
      // MachineEventLedger records the transition. Pre-T1-202 only
      // the console.warn above existed; support bundles couldn't see
      // a placement-uncertain event after a renderer crash.
      this._safetyEventSink?.({
        kind: 'placement-uncertain',
        t: Date.now(),
        reason: verdict.reason,
      });
      for (const cb of this._stateListeners) {
        cb({ ...this._state });
      }
      return;
    }

    // verdict.kind === 'verified-nonzero': established existing
    // T1-20 path — emit a consent payload to the UI listener.
    this._emitWcsPayload(verdict.g54, verdict.statusMask);
  }

  private _emitWcsPayload(
    g54: { x: number; y: number; z: number } | null,
    mask: number,
  ): void {
    if (this._wcsConsentListeners.size === 0) {
      // T1-20: pre-T1-20 the no-listener fallback silently auto-applied
      // normalization. That's a hidden mutation path: if the UI's
      // consent listener registers AFTER connect (subscription race,
      // unmounted component), G54 and $10 get rewritten without user
      // consent. Default behavior now refuses to auto-apply and marks
      // the controller placement-uncertain - the UI gates job start
      // until the user disconnects, ensures the listener is attached,
      // and reconnects (or the machine is in fact already at baseline,
      // in which case _emitWcsConsentNeeded directly calls
      // applyWcsNormalization without going through this path).
      //
      // Tests / headless callers that need the pre-T1-20 behavior pass
      // `allowHeadlessWcsAutoNormalize: true` to the constructor.
      if (this._allowHeadlessWcsAutoNormalize) {
        console.warn(
          '[GrblController] onWcsConsentNeeded would fire with no listeners - '
          + 'applying WCS normalization without user prompt because '
          + 'allowHeadlessWcsAutoNormalize was passed to the constructor.',
        );
        this.applyWcsNormalization();
        return;
      }
      console.warn(
        '[GrblController] T1-20: WCS consent listener not registered when '
        + 'consent was needed. Refusing to auto-apply - controller marked '
        + 'placement-uncertain. Job start will be blocked until the user '
        + 'disconnects, attaches a listener, and reconnects.',
      );
      this._placementUncertain = true;
      // T1-202: forward to the injected safety-event sink (see the
      // T1-117 site above for rationale). The reason here is the
      // no-consent-listener fallback rather than a verdict.reason
      // from classifyWcsConsentInputs.
      this._safetyEventSink?.({
        kind: 'placement-uncertain',
        t: Date.now(),
        reason: 'no_wcs_consent_listener',
      });
      // Notify state listeners so the UI re-renders and reads the new
      // gate value via getPlacementUncertain().
      for (const cb of this._stateListeners) {
        cb({ ...this._state });
      }
      return;
    }
    const payload: WcsConsentSnapshot = {
      g54: g54 ?? { x: 0, y: 0, z: 0 },
      statusMask: mask,
    };
    for (const cb of this._wcsConsentListeners) {
      cb(payload);
    }
  }

  private _emitObjectLifecycle(activeObjectIds: readonly string[]): void {
    const key = activeObjectIds.length === 0 ? '' : [...activeObjectIds].sort().join('\0');
    if (this._lastLifecycleKey !== null && key === this._lastLifecycleKey) return;
    this._lastLifecycleKey = key;
    for (const listener of this._objectLifecycleListeners) {
      listener(activeObjectIds);
    }
  }

  // ─── LINE HANDLER ───────────────────────────────────────────

  private _handleLine(line: string): void {
    if (this._awaitingWcsQueryOk) {
      if (line === 'ok') {
        this._onWcsQueryOk();
        return;
      }
      if (line.startsWith('error:')) {
        // T1-174 (audit Critical #5): WCS query error must FAIL CLOSED,
        // not fail open. Pre-T1-174 this branch called
        // `skipWcsNormalization()` which set `_placementUncertain =
        // false` — treating a controller-reported failure to read the
        // WCS state as if the user had explicitly decided to skip
        // normalization. The audit flagged this as Critical: a
        // saved-origin job could then start from an unknown WCS
        // offset, engraving in the wrong physical location.
        //
        // Post-T1-174: mark the settings handshake done (so we don't
        // loop trying to re-query) AND mark placement uncertain with
        // a dedicated reason so the start-job gate refuses until the
        // user disconnects + reconnects from a known-safe state.
        console.warn(
          `[GrblController] T1-174: WCS query \`$#\` returned error response (${line}). `
          + 'Refusing to mark placement safe. Job start blocked until the user '
          + 'disconnects, addresses the underlying state, and reconnects.',
        );
        this._awaitingWcsQueryOk = false;
        this._currentG54 = null;
        this._settingsQueried = true;
        this._placementUncertain = true;
        this._lastPlacementUncertainReason = 'wcs_query_error';
        // T1-202: emit TWO ledger events for this single transition —
        // the upstream wcs-query-error (carrying the raw GRBL error
        // line for forensics) and the resulting placement-uncertain
        // transition (matching the reason field tracked on the
        // controller). The two-event pattern lets support bundles
        // distinguish "$# itself errored" from "placement became
        // uncertain for a different reason at the same moment".
        const t = Date.now();
        this._safetyEventSink?.({
          kind: 'wcs-query-error',
          t,
          grblErrorLine: line,
        });
        this._safetyEventSink?.({
          kind: 'placement-uncertain',
          t,
          reason: 'wcs_query_error',
        });
        for (const cb of this._stateListeners) {
          cb({ ...this._state });
        }
        return;
      }
      this._tryParseG54WcsLine(line);
      return;
    }

    if (this._awaitingWorkOffsetRequestOk) {
      if (line === 'ok') {
        this._finishWorkOffsetRequest(this._currentG54);
        return;
      }
      if (line.startsWith('error:')) {
        this._currentG54 = null;
        this._finishWorkOffsetRequest(null);
        return;
      }
      this._tryParseG54WcsLine(line);
      return;
    }

    // T3-50: identity-await runs BEFORE settings-await so the `$I`
    // ok is consumed here and never reaches the `$$` branch. `[VER:]`
    // / `[OPT:]` lines also route through here so the parser captures
    // them deterministically even while `_awaitingSettingsOk` is true
    // (post-`$$`-write but pre-first-`$$`-response).
    if (this._awaitingIdentityOk) {
      if (line === 'ok') {
        this._awaitingIdentityOk = false;
        return;
      }
      if (line.startsWith('error:')) {
        this._awaitingIdentityOk = false;
        // Fall through to surface the error.
      } else if (this._tryParseIdentityLine(line)) {
        return;
      }
    }

    if (this._awaitingSettingsOk) {
      if (line === 'ok') {
        this._onSettingsDollarOk();
        return;
      }
      if (line.startsWith('error:')) {
        this._awaitingSettingsOk = false;
        // Fall through so the error is surfaced like any other GRBL error.
      } else if (this._parseDollarSetting(line)) {
        return;
      }
    }

    if (line === 'ok') {
      this._recordJobStatusHeartbeatResponse();
      this._handleOk();
    } else if (line.startsWith('error:')) {
      this._handleError(line);
    } else if (line.startsWith('<') && line.endsWith('>')) {
      this._handleStatusReport(line);
    } else if (line.startsWith('ALARM:')) {
      this._handleAlarm(line);
    } else if (line.startsWith('Grbl')) {
      this._updateStatus('idle');
    } else if (this._tryParseIdentityLine(line)) {
      /* T3-50: identity line ([VER:...] / [OPT:...]) captured */
    } else if (this._parseDollarSetting(line)) {
      /* setting line outside active $$ dump — map already updated */
    }
  }

  /**
   * T3-50: capture firmware identity from `$I` response lines. Stock GRBL
   * emits `[VER:1.1h.20221128:]` and `[OPT:VL,15,128]`; some forks include
   * a build-tag suffix after a second `:`. Returns true if the line matched
   * a `[VER:...]` or `[OPT:...]` shape so the caller can avoid a second
   * `_parseDollarSetting` attempt on the same line.
   */
  // T1-137: delegates parsing to parseGrblIdentityLine; this method
  // applies the parsed fields to controller state and returns whether
  // the line matched so the dispatcher can avoid a second parse pass.
  private _tryParseIdentityLine(line: string): boolean {
    const parsed = parseGrblIdentityLine(line);
    if (parsed === null) return false;
    if ('firmwareVersion' in parsed) {
      this._firmwareVersion = parsed.firmwareVersion;
    } else {
      this._buildOptions = parsed.buildOptions;
    }
    return true;
  }

  private _handleOk(): void {
    if (this._pending.length === 0) return;

    const oldest = this._pending.shift()!;
    this._bufferAvailable += oldest.byteCount;
    if (!oldest.system) {
      this._linesAcknowledged++;
      this._recordAckTimestamp();
      if (oldest.marker != null) {
        this._emitObjectLifecycle(oldest.marker);
      }
      this._emitProgress();
    }

    if (this._isJobRunning &&
        this._isQueueDrainedForCompletion() &&
        this._pending.length === 0) {
      this._completeJob();
      return;
    }

    this._drainQueue();
  }

  private _handleError(line: string): void {
    const code = parseInt(line.split(':')[1], 10) || 0;

    // T1-24: capture job-active state at entry. Used both for the
    // safetyOff call (active jobs need the soft-reset stage; idle errors
    // are protocol-level and a queued M5 is sufficient) and to decide
    // the post-handler status (active-job errors must NOT transition to
    // 'idle' — see audit 1E and the post-handler block below).
    const wasJobRunning = this._isJobRunning;

    if (this._pending.length > 0) {
      const oldest = this._pending.shift()!;
      this._bufferAvailable += oldest.byteCount;
      if (!oldest.system) {
        this._linesAcknowledged++;
        this._recordAckTimestamp();
      }

      for (const cb of this._errorListeners) {
        cb(code, `GRBL error ${code} on line: ${oldest.text}`);
      }
    }

    // GRBL `error:N` is command-scoped. Only active-job errors become
    // recoverable machine holds; idle/protocol errors should not poison
    // Frame/Start gates after the controller is otherwise idle.
    this._state.errorCode = wasJobRunning ? code : null;
    this._emitProgress();

    // T1-24: actively command the laser off — but ONLY if a job was
    // running. Without an active job, GRBL `error:N` is protocol-level
    // (parsing, bad command, USB glitch) with no laser activity to
    // worry about, and an extra M5 just adds noise on the connect
    // handshake (the mock-port wake-up `\n` returns `error:20` in
    // tests, a synthetic case that surfaced this distinction).
    //
    // When a job IS active, `error:N` does NOT necessarily disable the
    // laser — modal M3/M4 state can persist through a parsing/protocol
    // error while the beam keeps burning. safetyOff() is the awaitable
    // two-stage M5 → soft-reset path installed by T1-22. Fire-and-
    // forget because the data dispatch loop is sync; if we awaited
    // here we'd back-pressure the entire stream including possible
    // recovery lines.
    //
    // safetyOff is documented to never throw — it returns
    // {stage: 'failed'} instead. Inspect the resolved value so a
    // failed safety-off gets logged for support.
    if (wasJobRunning) {
      void this._runControllerOwnedSafetyOff('job-error', code).then(result => {
        if (result.stage === 'failed') {
          console.warn(
            '[GrblController] T1-24: safetyOff after error:%d returned failed:',
            code, result.error,
          );
        }
      }).catch((err: unknown) => {
        // Defense-in-depth — safetyOff is documented to not throw.
        console.warn('[GrblController] T1-24: safetyOff after error threw unexpectedly:', err);
      });
    }

    // Stop streaming on error by default — safer for real machines
    if (this._stopOnError) {
      this._abortJob();
      // T1-24 + audit 1E: transition to a halt-state (not 'idle')
      // after an error during an active job. The UI reads 'idle' as
      // "ready for next job" — a user who ignored the error and clicked
      // Run would start a new job from a state where the previous
      // error left the laser potentially still on, in unknown position.
      // Forcing a halt-state makes the UI gate the Run button until the
      // user consciously clears.
      //
      // T2-12 part 2: active-job errors now transition to
      // 'faulted_requires_inspection' rather than 'alarm'. The two
      // states are semantically distinct:
      //  - 'alarm' is hardware-reported by GRBL (cleared via $X) and
      //    arrives through machineStatusFromGrblReportToken at the top
      //    of the file; this writer never touches it.
      //  - 'faulted_requires_inspection' is software-synthesized by us
      //    when we stop a job mid-execution; recovery is via
      //    acknowledgeFault() after the user inspects the machine.
      //
      // For idle errors (e.g. user typed an invalid console command),
      // the previous status was already 'idle' and there's no laser
      // motion to lock down — preserve the existing 'idle' transition.
      this._updateStatus(wasJobRunning ? 'faulted_requires_inspection' : 'idle');
      return;
    }

    this._drainQueue();
  }

  private _handleAlarm(line: string): void {
    const code = parseInt(line.split(':')[1], 10) || 0;
    this._state.alarmCode = code;
    this._updateStatus('alarm');
    this._abortJob();

    // T1-24: actively command the laser off. The GRBL spec says ALARM
    // disables spindle/laser at firmware level, but that's a
    // firmware-side promise, not a software-side proof. If the alarm
    // condition itself was caused by a firmware bug, USB glitch, or
    // partial reset, the laser can be in an undefined state. safetyOff
    // is a defense-in-depth confirmation. Fire-and-forget for the same
    // reason as _handleError above.
    void this._runControllerOwnedSafetyOff('alarm', code).then(result => {
      if (result.stage === 'failed') {
        console.warn(
          '[GrblController] T1-24: safetyOff after ALARM:%d returned failed:',
          code, result.error,
        );
      }
    }).catch((err: unknown) => {
      console.warn('[GrblController] T1-24: safetyOff after alarm threw unexpectedly:', err);
    });

    for (const cb of this._errorListeners) {
      cb(code, `ALARM:${code} — machine halted`);
    }
  }

  // ─── STATUS REPORT PARSING ──────────────────────────────────

  private _handleStatusReport(raw: string): void {
    this._recordJobStatusHeartbeatResponse();
    // T1-124: pure parsing now lives in `parseGrblStatusReport`
    // (src/controllers/grbl/GrblStatusReportParser.ts) — first slice
    // of the audit's Sprint 4 "extract pure parsers first" sequence.
    // The parser returns a structured record; this method applies
    // side effects (state mutation, pause/resume bookkeeping,
    // job-abort gates, safe-state-at-connect verdict). Behavior is
    // byte-identical to the pre-T1-124 inline implementation.
    const parsed = parseGrblStatusReport(raw);
    if (parsed.stateWord === null) return;

    const newStatus = parsed.machineStatus;
    if (newStatus && this._state.status !== 'disconnected' && this._state.status !== 'connecting') {
      if (this._pausePending) {
        if (newStatus === 'hold' || newStatus === 'alarm' || newStatus === 'idle' || newStatus === 'homing' || newStatus === 'check') {
          this._state.status = newStatus;
          if (newStatus === 'hold') this._pausePending = false;
          if (newStatus === 'alarm' || newStatus === 'idle' || newStatus === 'homing' || newStatus === 'check') {
            this._pausePending = false;
          }
        }
        // Stale Run while feed-hold is taking effect — keep internal Hold.
      } else if (this._resumeRequested) {
        if (newStatus === 'run' || newStatus === 'alarm' || newStatus === 'idle' || newStatus === 'homing' || newStatus === 'check') {
          this._state.status = newStatus;
          if (newStatus === 'run') this._resumeRequested = false;
          if (newStatus === 'alarm' || newStatus === 'idle' || newStatus === 'homing' || newStatus === 'check') {
            this._resumeRequested = false;
          }
        }
        // Stale Hold until cycle-start takes effect — keep internal Run for streaming.
      } else {
        this._state.status = newStatus;
      }
    }

    // Defensive: if a job is marked running but the status report shows alarm, or
    // idle with queue drained, reset internal job state. Covers alarm reported only
    // via periodic '?' (no `ALARM:N` line) or a stuck _isJobRunning after completion.
    if (this._isJobRunning) {
      const st = this._state.status;
      if (
        st === 'alarm' ||
        (st === 'idle' &&
          this._isQueueDrainedForCompletion() &&
          this._pending.length === 0)
      ) {
        this._abortJob();
        this._emitProgress();
      }
    }

    if (parsed.feedRate != null) this._state.feedRate = parsed.feedRate;
    if (parsed.spindleSpeed != null) this._state.spindleSpeed = parsed.spindleSpeed;

    if (parsed.wPos) {
      this._state.position = parsed.wPos;
      this._positionConfirmed = true; // T1-44
    } else if (parsed.mPos) {
      this._state.position = parsed.mPos;
      this._positionConfirmed = true; // T1-44
    }

    // T1-25: first status report after connect — compute the safe-state
    // verdict from the now-current `_state.status`, FS field, and alarm
    // code, then disarm. Subsequent status reports during the session
    // do not retrigger this — the contract is a connect-time check, not
    // a continuous monitor. (Mid-session alarm / hold transitions are
    // handled by their own listeners — T1-24 / safetyOff / pause.)
    if (this._safeStateCheckArmed) {
      this._safeStateCheckArmed = false;
      if (this._safeStateWatchdog !== null) {
        clearTimeout(this._safeStateWatchdog);
        this._safeStateWatchdog = null;
      }
      const reason = this._classifySafeStateReason();
      if (reason !== null) {
        this._unsafeAtConnect = {
          reason,
          capturedAt: Date.now(),
          status: this._state.status,
          alarmCode: this._state.alarmCode,
          feedRate: this._state.feedRate,
          spindleSpeed: this._state.spindleSpeed,
        };
      }
    }

    // T1-111: clear the connect-time verdict once the controller has
    // demonstrably recovered to a known-safe state (idle + FS 0,0).
    // T1-25's contract for RAISING the verdict is a one-shot connect
    // check (see block above; no re-arm in-session). T1-111 keeps that
    // contract and only adds the symmetric CLEAR path: if the user
    // recovers via Unlock ($X clears alarm → status returns to idle)
    // or completes homing (post-home status → idle + FS 0,0) and the
    // classifier now returns null, the verdict no longer reflects
    // current reality. Pre-T1-111 the verdict was sticky for the
    // entire session — clicking the on-screen Unlock recovery button
    // cleared the alarm at the controller but left preflight blocking
    // Start with "alarm state from previous session," forcing
    // disconnect+reconnect to recover. CLEAR-only is safe wrt T1-25:
    // it can never raise a new verdict, only release a stale one.
    if (this._unsafeAtConnect != null && this._classifySafeStateReason() === null) {
      this._unsafeAtConnect = null;
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

    if (this._streamIterator !== null) {
      this._drainStreamWindow();
      return;
    }

    while (this._queueIndex < this._jobLines.length) {
      const line = this._jobLines[this._queueIndex];
      const byteCount = line.length + 1;

      if (byteCount > this._bufferAvailable) break;

      const marker = this._lineMarkers[this._queueIndex];
      this._writeLine(line);
      // T1-220: count AFTER the write so a throw doesn't credit a
      // failed write to the running total. This counter is the
      // load-bearing signal for the failed-start unsafe-prior-state
      // carve-out in MachineService — any non-zero count means at
      // least one machine-affecting line hit the transport.
      this._jobLinesWrittenSinceJobStart++;
      this._pending.push({ text: line, byteCount, marker });
      this._bufferAvailable -= byteCount;
      this._queueIndex++;
      this._recordSendTimestamp();
    }
  }

  private _drainStreamWindow(): void {
    while (this._jobLines.length > 0) {
      const line = this._jobLines[0];
      const byteCount = line.length + 1;

      if (byteCount > this._bufferAvailable) break;

      const marker = this._lineMarkers[0];
      this._writeLine(line);
      this._jobLinesWrittenSinceJobStart++;
      this._pending.push({ text: line, byteCount, marker });
      this._bufferAvailable -= byteCount;
      this._jobLines.shift();
      this._lineMarkers.shift();
      this._queueIndex++;
      this._recordSendTimestamp();
    }

    if (this._jobLines.length === 0 && !this._streamDone && !this._streamFillInFlight) {
      void this._fillStreamWindow()
        .then(() => this._drainQueue())
        .catch(err => this._handleStreamFillError(err));
    }
  }

  private _isQueueDrainedForCompletion(): boolean {
    if (this._streamIterator !== null) {
      return this._streamDone && this._jobLines.length === 0;
    }
    return this._queueIndex >= this._jobLines.length;
  }

  // ─── JOB LIFECYCLE ──────────────────────────────────────────

  private _completeJob(): void {
    this._resetJobStatusHeartbeat();
    this._isJobRunning = false;
    this._clearStreamState();
    this._updateStatus('idle');
    this._emitProgress();
    this._lastLifecycleKey = null;
    this._emitObjectLifecycle([]);
  }

  private _abortJob(): void {
    this._resetJobStatusHeartbeat();
    this._isJobRunning = false;
    this._clearStreamState();
    this._jobLines = [];
    this._lineMarkers = [];
    this._queueIndex = 0;
    this._jobTotalLines = 0;
    this._pending = [];
    this._bufferAvailable = GRBL_BUFFER_SIZE;
    this._pausePending = false;
    this._resumeRequested = false;
    this._ackTimestamps = [];
    this._sendTimestamps = [];
    this._lastLifecycleKey = null;
    this._emitObjectLifecycle([]);
  }

  // ─── INTERNALS ──────────────────────────────────────────────

  private _writeLine(line: string): void {
    if (!this._port?.isOpen) return;
    this._port.write(line + '\n');
    this._emitRawLine(line, 'tx', 'user');
    this._trackSpindleMode(line);
  }

  /**
   * Like _writeLine, but tags the emission as 'system' so consumers
   * can visually distinguish handshake / internal config traffic from
   * user-driven commands. Used for post-connect $$ / G10 / $10 only.
   */
  private _writeSystemLine(line: string): void {
    if (!this._port?.isOpen) return;
    this._port.write(line + '\n');
    this._emitRawLine(line, 'tx', 'system');
    this._trackSpindleMode(line);
  }

  /**
   * Write an internal planner-buffered command while preserving job ack
   * accounting. GRBL will still return `ok` for these lines; when a job is
   * active, enqueue a zero-byte system sentinel so that `ok` is not counted
   * as an acknowledged job gcode line. T1-23 uses this for pause/resume
   * M5/M3/M4 belt-and-suspenders commands.
   */
  private async _writeCriticalSystemLine(
    line: string,
    options: { trackSpindleMode?: boolean } = {},
  ): Promise<void> {
    if (!this._port?.isOpen) throw new Error('Not connected');
    const pending: PendingLine | null = this._isJobRunning
      ? { text: line, byteCount: 0, system: true }
      : null;
    if (pending) this._pending.push(pending);
    try {
      await this._port.writeCritical(line + '\n');
    } catch (err) {
      if (pending) {
        const idx = this._pending.indexOf(pending);
        if (idx >= 0) this._pending.splice(idx, 1);
      }
      throw err;
    }
    this._emitRawLine(line, 'tx', 'system');
    if (options.trackSpindleMode !== false) {
      this._trackSpindleMode(line);
    }
  }

  /**
   * T1-23: track modal spindle/laser mode from outgoing gcode. Parenthesized
   * comments are stripped so an M5 mention in a comment does not clear state.
   */
  private _trackSpindleMode(line: string): void {
    const codePart = line.split('(')[0]!;
    if (codePart.includes('M5')) {
      this._lastSpindleMode = null;
      return;
    }
    if (codePart.includes('M4')) {
      this._lastSpindleMode = 'M4';
      return;
    }
    if (codePart.includes('M3')) {
      this._lastSpindleMode = 'M3';
    }
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

  private _recordAckTimestamp(): void {
    const now = Date.now();
    this._ackTimestamps.push(now);
    if (this._ackTimestamps.length > this.ACK_RATE_WINDOW_SIZE) {
      this._ackTimestamps.shift();
    }
  }

  private _recordSendTimestamp(): void {
    const now = Date.now();
    this._sendTimestamps.push(now);
    if (this._sendTimestamps.length > this.ACK_RATE_WINDOW_SIZE) {
      this._sendTimestamps.shift();
    }
  }

  private _emitProgress(): void {
    const total = this._jobTotalLines || this._jobLines.length;
    const bufferFill = GRBL_BUFFER_SIZE - this._bufferAvailable;
    const { healthStatus, ackRateHz, expectedAckRateHz } = computeStreamingHealth({
      now: Date.now(),
      ackTimestamps: this._ackTimestamps,
      sendTimestamps: this._sendTimestamps,
      bufferFill,
      grblBufferCapacity: GRBL_BUFFER_SIZE,
      isJobRunning: this._isJobRunning,
    });
    const progress: JobProgress = {
      linesSent: this._queueIndex,
      linesAcknowledged: this._linesAcknowledged,
      totalLines: total,
      percentComplete: total > 0 ? (this._linesAcknowledged / total) * 100 : 0,
      elapsedMs: Date.now() - this._jobStartTime,
      bufferFill,
      healthStatus,
      ackRateHz,
      expectedAckRateHz,
    };
    for (const cb of this._progressListeners) {
      cb(progress);
    }
  }

  private _emitRawLine(
    line: string,
    direction: 'tx' | 'rx',
    kind: 'user' | 'system' = 'user',
  ): void {
    for (const cb of this._rawLineListeners) {
      cb(line, direction, kind);
    }
  }

  // ─── STATUS POLLING ─────────────────────────────────────────

  private _startStatusPolling(): void {
    this._stopStatusPolling();
    this._pollTimer = setInterval(() => {
      this._pollStatus();
    }, STATUS_POLL_INTERVAL);
  }

  // T3-53: status-poll realtime writes can fail outside port.onError.
  private _pollStatus(): void {
    try {
      if (this._isJobRunning) {
        this._pollJobStatusHeartbeat();
      } else {
        this.requestStatusReport();
      }
    } catch (err: unknown) {
      this._handleStatusPollFailure(err);
    }
  }

  /**
   * T3-16/T1-248: while a job is running, a physically yanked USB cable can
   * take longer to surface through WebSerial close/error callbacks than
   * through missed realtime status replies. A late status report is only a
   * warning; the stream is aborted only after sustained silence from every
   * controller RX path (`ok`, `error:`, `ALARM:`, status, identity, etc.).
   */
  private _pollJobStatusHeartbeat(): void {
    if (this._jobStatusHeartbeatAwaitingResponse) return;
    this.requestStatusReport();
    this._jobStatusHeartbeatAwaitingResponse = true;
    this._jobStatusHeartbeatTimer = setTimeout(
      () => this._handleJobStatusHeartbeatTimeout(),
      JOB_STATUS_REPLY_WARN_MS,
    );
  }

  private _recordControllerRx(): void {
    this._lastControllerRxAt = Date.now();
    this._jobStatusHeartbeatWarned = false;
  }

  private _recordJobStatusHeartbeatResponse(): void {
    if (!this._jobStatusHeartbeatAwaitingResponse && !this._jobStatusHeartbeatWarned) return;
    if (this._jobStatusHeartbeatTimer !== null) {
      clearTimeout(this._jobStatusHeartbeatTimer);
      this._jobStatusHeartbeatTimer = null;
    }
    this._jobStatusHeartbeatAwaitingResponse = false;
    this._jobStatusHeartbeatWarned = false;
  }

  private _handleJobStatusHeartbeatTimeout(): void {
    this._jobStatusHeartbeatTimer = null;
    if (!this._jobStatusHeartbeatAwaitingResponse) return;
    this._jobStatusHeartbeatAwaitingResponse = false;

    if (!this._isJobRunning) return;

    const lastRxAt = this._lastControllerRxAt > 0 ? this._lastControllerRxAt : this._jobStartTime;
    const silentForMs = Date.now() - lastRxAt;
    if (silentForMs < JOB_NO_RX_ABORT_MS) {
      if (!this._jobStatusHeartbeatWarned) {
        this._jobStatusHeartbeatWarned = true;
        for (const cb of this._errorListeners) {
          cb(-1,
            `Status heartbeat delayed during running job; controller last replied ${Math.round(silentForMs)}ms ago. Keeping job alive unless all controller replies stop.`);
        }
      }
      return;
    }

    this._handleStatusPollFailure(new Error(
      `controller silent for ${Math.round(silentForMs)}ms during running job (no ok/error/status replies)`,
    ));
  }

  private _handleStatusPollFailure(err: unknown): void {
    this._stopStatusPolling();
    const message = err instanceof Error ? err.message : String(err);
    for (const cb of this._errorListeners) {
      cb(-1, `Status polling failed: ${message}`);
    }
    this._handleTransportDisconnect(true);
  }

  private _stopStatusPolling(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    this._resetJobStatusHeartbeat();
  }

  private _resetJobStatusHeartbeat(): void {
    if (this._jobStatusHeartbeatTimer !== null) {
      clearTimeout(this._jobStatusHeartbeatTimer);
      this._jobStatusHeartbeatTimer = null;
    }
    this._jobStatusHeartbeatAwaitingResponse = false;
    this._jobStatusHeartbeatWarned = false;
  }

  // ─── POST-CONNECT MACHINE SETTINGS ($$) ─────────────────────

  private _resetMachineSettingsCache(): void {
    this._homingDir = 0;
    this._laserMode = false;
    this._bedWidth = 0;
    this._bedHeight = 0;
    this._maxFeedX = 0;
    this._maxFeedY = 0;
    this._maxAccelX = 0;
    this._maxAccelY = 0;
  }

  /** Run after welcome + connect promise resolve; does not run during welcome detection. */
  private _queryMachineSettings(): void {
    if (!this._port?.isOpen) return;
    this._grblSettings.clear();
    this._resetMachineSettingsCache();
    this._maxSpindle = null;
    this._settingsQueried = false;
    // T3-50: solicit `$I` before `$$` so `[VER:...]` / `[OPT:...]`
    // are captured even when the Falcon's welcome banner arrives
    // before the connect-time `$I` probe fires. Both awaits arm
    // before either ok arrives; `_awaitingIdentityOk` runs first in
    // `_handleLine` so the `$I` ok is consumed by the identity
    // branch and never reaches the settings branch. `[VER:]` /
    // `[OPT:]` lines are captured by `_tryParseIdentityLine` in the
    // identity branch as well; once the `$I` ok clears the flag,
    // the `$$` response stream is consumed by the settings branch
    // unchanged.
    this._awaitingIdentityOk = true;
    this._writeSystemLine('$I');
    this._awaitingSettingsOk = true;
    this._writeSystemLine('$$');
  }

  /**
   * Returns true if `line` was a `$N=value` setting (stored in
   * `_grblSettings`).
   *
   * T1-126: pure parsing + interpretation now lives in
   * `GrblSettingsParser.ts`. This method is the side-effect shell:
   * it stores the raw value in the map and applies the per-setting
   * interpretation by reading the typed view returned by
   * `interpretGrblSettingValue`. Behavior is byte-identical to the
   * pre-T1-126 inline implementation.
   */
  private _parseDollarSetting(line: string): boolean {
    const parsed = parseGrblSettingLine(line);
    if (parsed === null) return false;
    this._grblSettings.set(parsed.number, parsed.rawValue);

    const interpreted = interpretGrblSettingValue(parsed.number, parsed.rawValue);
    if (interpreted.homingDir !== undefined) this._homingDir = interpreted.homingDir;
    if (interpreted.maxSpindle !== undefined) {
      this._maxSpindle = interpreted.maxSpindle;
      // $30 is the only interpreted field that fires a state-listener
      // notification. Pre-T1-126 the listener fired exactly when the
      // pre-fix gate (finite && > 0) accepted the value, which is the
      // same condition the parser uses to set maxSpindle, so this
      // preserves the firing pattern.
      for (const cb of this._stateListeners) {
        cb({ ...this._state });
      }
    }
    if (interpreted.laserMode !== undefined) this._laserMode = interpreted.laserMode;
    if (interpreted.bedWidth !== undefined) this._bedWidth = interpreted.bedWidth;
    if (interpreted.bedHeight !== undefined) this._bedHeight = interpreted.bedHeight;
    if (interpreted.maxFeedX !== undefined) this._maxFeedX = interpreted.maxFeedX;
    if (interpreted.maxFeedY !== undefined) this._maxFeedY = interpreted.maxFeedY;
    if (interpreted.maxAccelX !== undefined) this._maxAccelX = interpreted.maxAccelX;
    if (interpreted.maxAccelY !== undefined) this._maxAccelY = interpreted.maxAccelY;
    return true;
  }

  /**
   * T1-25: returns the safe-state verdict captured at connect, or null when
   * the handshake passed (idle + FS 0,0). Cleared by `disconnect()` and
   * re-armed by the next `connect()` welcome. Read by the preflight blocker
   * `MACHINE_UNSAFE_AT_CONNECT` and any UI surface that needs to refuse
   * machine control until the user acknowledges.
   */
  getUnsafeAtConnect(): UnsafeAtConnectState | null {
    return this._unsafeAtConnect;
  }

  /**
   * T1-25: arm the safe-state-at-connect check. Called from the welcome
   * handler. The first subsequent status report fires the verdict. A 5-
   * second watchdog catches the `'no-status-response'` case (wedged
   * firmware, dead cable, port silent after `<Hold|...>` welcome with no
   * follow-up poll response). 5 s is conservative — the existing
   * `STATUS_POLL_INTERVAL` is much shorter, so a healthy controller fires
   * the hook within milliseconds.
   */
  private _armSafeStateCheck(): void {
    this._safeStateCheckArmed = true;
    this._unsafeAtConnect = null;
    if (this._safeStateWatchdog !== null) {
      clearTimeout(this._safeStateWatchdog);
    }
    this._safeStateWatchdog = setTimeout(() => {
      if (!this._safeStateCheckArmed) return;
      this._safeStateCheckArmed = false;
      this._safeStateWatchdog = null;
      this._unsafeAtConnect = {
        reason: 'no-status-response',
        capturedAt: Date.now(),
        status: this._state.status,
        alarmCode: this._state.alarmCode,
        feedRate: this._state.feedRate,
        spindleSpeed: this._state.spindleSpeed,
      };
      for (const cb of this._stateListeners) {
        cb({ ...this._state });
      }
    }, 5000);
  }

  /**
   * T1-25: classify the current `_state` into an UnsafeAtConnectReason, or
   * null if the controller is in a known-safe configuration (idle + FS 0,0).
   *   - alarm    → previous session ended in alarm; user must inspect.
   *   - run/hold → firmware thinks a job is active; user must inspect.
   *   - check    → check-mode is on; not a burning state but unexpected.
   *   - door     → safety door open / triggered.
   *   - unsafe-residual-spindle → idle but FS reports non-zero spindle,
   *     meaning the laser is still in modal M3/M4 from a prior operation.
   */
  /**
   * T1-128: classification logic moved to `classifyGrblSafeState` in
   * `GrblSafeStateClassifier.ts`. This method is the controller-side
   * shell that snapshots the relevant `_state` fields and delegates.
   * Behavior is byte-identical to the pre-T1-128 inline implementation.
   */
  private _classifySafeStateReason(): UnsafeAtConnectReason | null {
    return classifyGrblSafeState({
      status: this._state.status,
      spindleSpeed: this._state.spindleSpeed,
      feedRate: this._state.feedRate,
    });
  }

  /**
   * GRBL $22: homing cycle enable. `true` if $22=1, `false` if $22=0, `undefined` if not in $$ cache.
   */
  getFirmwareHomingCycleEnabled(): boolean | undefined {
    if (!this._grblSettings.has(22)) return undefined;
    const v = this._grblSettings.get(22)!.trim();
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return undefined;
    return n !== 0;
  }

  /**
   * GRBL $32: laser mode. `true` if $32=1 (laser dynamic mode), `false` if $32=0 (CNC/spindle mode),
   * `undefined` if not in $$ cache. T1-32: surfaces the live firmware value so preflight can refuse
   * M4 jobs against a CNC-mode controller where M4 keeps the laser on at full power between moves.
   * Reads the cached $$ dump rather than `_laserMode` directly so the source matches the
   * `getFirmwareHomingCycleEnabled` shape (cache-or-undefined, not zero-value-as-default).
   */
  getFirmwareLaserModeEnabled(): boolean | undefined {
    if (!this._grblSettings.has(32)) return undefined;
    const v = this._grblSettings.get(32)!.trim();
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return undefined;
    return n !== 0;
  }

  /**
   * T3-50: snapshot the device identity captured during connect / settings
   * query. `firmwareVersion` and `buildOptions` come from the `$I` response
   * lines `[VER:...]` and `[OPT:...]`; the bed/spindle/laser/homing fields
   * come from the `$$` dump and follow the cache-or-null convention used by
   * `getFirmwareHomingCycleEnabled` / `getFirmwareLaserModeEnabled`. Used by
   * preflight rules (T3-57) and by future ConnectionManager (T2-32) profile-
   * binding checks. Returns a fresh object on every call so callers can
   * snapshot at preflight-time without holding a live reference.
   */
  getDeviceIdentity(): DeviceIdentity {
    return {
      firmwareVersion: this._firmwareVersion,
      buildOptions: this._buildOptions,
      maxSpindle: this._maxSpindle,
      bedWidthMm: this._bedWidth > 0 ? this._bedWidth : null,
      bedHeightMm: this._bedHeight > 0 ? this._bedHeight : null,
      homingDirection: this._grblSettings.has(23) ? this._homingDir : null,
      homingEnabled: this.getFirmwareHomingCycleEnabled() ?? null,
      laserMode: this.getFirmwareLaserModeEnabled() ?? null,
      // T3-57: $110/$111/$120/$121 read from the latest $$ dump. The
      // private `_maxFeedX/Y` / `_maxAccelX/Y` fields default to 0
      // before the first $$ response; map zero to null so callers
      // can distinguish "firmware never reported" from "firmware
      // reported zero".
      maxRateXMmPerMin: this._maxFeedX > 0 ? this._maxFeedX : null,
      maxRateYMmPerMin: this._maxFeedY > 0 ? this._maxFeedY : null,
      maxAccelXMmPerS2: this._maxAccelX > 0 ? this._maxAccelX : null,
      maxAccelYMmPerS2: this._maxAccelY > 0 ? this._maxAccelY : null,
    };
  }
}
