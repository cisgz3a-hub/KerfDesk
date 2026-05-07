/**
 * GRBL 1.1 controller with character-counting buffer management.
 * Pipelines G-code for maximum throughput — no stuttering.
 */

import {
  type GrblControllerApi,
  type MachineState,
  type MachineStatus,
  type MachinePosition,
  type JobProgress,
  type StateChangeCallback,
  type ProgressCallback,
  type ErrorCallback,
  type RawLineCallback,
  type ObjectLifecycleCallback,
  type Unsubscribe,
  type WcsConsentSnapshot,
} from '../ControllerInterface';
import { type SerialPortLike } from '../../communication/SerialPort';
import { computeStreamingHealth } from './streamingHealth';

const GRBL_BUFFER_SIZE = 127;
const STATUS_POLL_INTERVAL = 200;
const REALTIME_STATUS = 0x3F;
const REALTIME_FEED_HOLD = 0x21; // '!'
const REALTIME_CYCLE_START = 0x7E; // '~'
const REALTIME_RESET = 0x18;

const GRBL_SETTING_LINE = /^\$(\d+)=(.+)$/;
const GRBL_G54_WCS_LINE = /^\[G54:([^,]+),([^,]+),([^\]]+)\]$/;

interface PendingLine {
  text: string;
  byteCount: number;
  system?: boolean;
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
export type UnsafeAtConnectReason =
  | 'alarm'
  | 'run'
  | 'hold'
  | 'check'
  | 'no-status-response'
  | 'unsafe-residual-spindle';

/**
 * T1-25: snapshot of the controller's state captured at the first status
 * report after connect (or at watchdog timeout). A null value from
 * `getUnsafeAtConnect()` means the safe-state handshake passed (idle + FS
 * 0,0). A non-null value means job start, frame, jog, and test-fire must
 * be refused by the UI / preflight layer until the user acknowledges and
 * reconnects (the spec's "machineControlAllowed: false" semantic).
 */
export interface UnsafeAtConnectState {
  reason: UnsafeAtConnectReason;
  capturedAt: number;
  status: MachineStatus;
  alarmCode: number | null;
  feedRate: number;
  spindleSpeed: number;
}

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

  private _state: MachineState;
  private _port: SerialPortLike | null = null;
  private _isJobRunning = false;

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
  private _queueIndex = 0;
  private _pending: PendingLine[] = [];
  private _bufferAvailable = GRBL_BUFFER_SIZE;
  private _linesAcknowledged = 0;
  private _jobStartTime = 0;

  /** Ring buffer of ok-ack timestamps (ms) for rolling ack rate. */
  private _ackTimestamps: number[] = [];
  /** Ring buffer of job-line send timestamps (ms) for expected ack rate. */
  private _sendTimestamps: number[] = [];
  private readonly ACK_RATE_WINDOW_SIZE = 100;
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
  /** Waiting for `ok` after a `$#` WCS / parameter report. */
  private _awaitingWcsQueryOk = false;
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
   * T1-20: opt-in for tests / headless callers that need the pre-T1-20
   * auto-apply behavior on no-listener fallback. Default false (production
   * safety > test convenience). See `_emitWcsPayload`.
   */
  private readonly _allowHeadlessWcsAutoNormalize: boolean;

  private _pollTimer: ReturnType<typeof setInterval> | null = null;

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

  /** When false, GRBL `error:` during a job is logged but streaming may continue. Default true. */
  setStopOnError(value: boolean): void {
    this._stopOnError = value;
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

  // ─── LIFECYCLE ──────────────────────────────────────────────

  async connect(port: SerialPortLike): Promise<void> {
    if (this._port) throw new Error('Already connected. Disconnect first.');

    this._maxSpindle = null;
    this._settingsQueried = false;
    this._resetMachineSettingsCache();
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
    this._updateStatus('connecting');

    return new Promise<void>((resolve, reject) => {
      let welcomeReceived = false;
      let timeout: ReturnType<typeof setTimeout>;
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

      port.onData((line) => {
        this._emitRawLine(line, 'rx');

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
          welcomeReceived = true;
          clearTimeout(timeout);
          clearProbeTimers();
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
      });

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

      port.onError((err) => {
        for (const cb of this._errorListeners) {
          cb(-1, `Serial error: ${err.message}`);
        }
        // Abort active job on serial error — don't wait for close
        this._abortJob();
      });

      port.onClose(() => {
        this._stopStatusPolling();
        this._abortJob();
        this._port = null;
        this._updateStatus('disconnected');
      });

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
          clearProbeTimers();
          this._stopStatusPolling();
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
    this._maxSpindle = null;
    this._settingsQueried = false;
    this._awaitingSettingsOk = false;
    this._awaitingWcsQueryOk = false;
    this._currentG54 = null;
    // T1-20: nothing to be uncertain about when not connected.
    this._placementUncertain = false;
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

    this._jobLines = jobLines;
    this._lineMarkers = lineMarkers;

    this._queueIndex = 0;
    this._pending = [];
    this._bufferAvailable = GRBL_BUFFER_SIZE;
    this._linesAcknowledged = 0;
    this._jobStartTime = Date.now();
    this._pausePending = false;
    this._resumeRequested = false;
    this._ackTimestamps = [];
    this._sendTimestamps = [];

    this._lastLifecycleKey = null;
    this._emitObjectLifecycle([]);

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

  private _parseJobLines(lines: string[]): {
    jobLines: string[];
    lineMarkers: (readonly string[] | null)[];
  } {
    const jobLines: string[] = [];
    const lineMarkers: (readonly string[] | null)[] = [];
    let pending: readonly string[] | null = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (line.length === 0) continue;
      if (line.startsWith(';')) {
        const m = line.match(/^;\s*OBJ\s+ids=(.+)$/i);
        if (m) {
          pending = m[1].split(',').map(s => s.trim()).filter(s => s.length > 0);
        }
        continue;
      }
      jobLines.push(line);
      lineMarkers.push(pending);
      pending = null;
    }
    return { jobLines, lineMarkers };
  }

  /**
   * Scan job lines for G0/G1 X/Y moves that exceed the controller's known bed
   * extents. Returns null on pass, error string on fail. Only the first 500
   * lines are considered (O(n) cap).
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
  private _checkJobBounds(lines: string[]): string | null {
    const bedW = this._bedWidth;
    const bedH = this._bedHeight;
    if (!(bedW > 0) || !(bedH > 0)) {
      return null;
    }

    const EPS = 0.01;
    let relative = false;
    const MAX_LINES = 500;

    // T1-44: simulated cursor for relative-mode tracking. Seeded from the last
    // confirmed status report; only consulted when a relative move is reached.
    let curX = this._state.position.x;
    let curY = this._state.position.y;

    for (let i = 0; i < lines.length && i < MAX_LINES; i++) {
      const line = lines[i];
      if (/^G91\b/i.test(line)) {
        relative = true;
        continue;
      }
      if (/^G90\b/i.test(line)) {
        relative = false;
        continue;
      }

      if (!/^\s*G0\d*\b/i.test(line) && !/^\s*G1\d*\b/i.test(line)) continue;

      const xMatch = line.match(/\bX([+-]?\d+(?:\.\d+)?)/i);
      const yMatch = line.match(/\bY([+-]?\d+(?:\.\d+)?)/i);
      if (!xMatch && !yMatch) continue;

      if (relative) {
        // T1-44: refuse the job if we don't actually know where the head is.
        if (!this._positionConfirmed) {
          return (
            'Cannot accept relative-mode job: current head position is unknown. ' +
            'Reconnect to refresh status, then try again.'
          );
        }
        if (xMatch) curX += parseFloat(xMatch[1]);
        if (yMatch) curY += parseFloat(yMatch[1]);
      } else {
        if (xMatch) curX = parseFloat(xMatch[1]);
        if (yMatch) curY = parseFloat(yMatch[1]);
      }

      if (Number.isFinite(curX) && (curX < -EPS || curX > bedW + EPS)) {
        return (
          `Job out of bounds: position would reach X=${curX.toFixed(3)} but machine bed is ` +
          `${bedW.toFixed(0)}mm wide. Recompile against the current profile or move the head.`
        );
      }
      if (Number.isFinite(curY) && (curY < -EPS || curY > bedH + EPS)) {
        return (
          `Job out of bounds: position would reach Y=${curY.toFixed(3)} but machine bed is ` +
          `${bedH.toFixed(0)}mm tall. Recompile against the current profile or move the head.`
        );
      }
    }
    return null;
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
  pause(): void {
    if (!this._port?.isOpen) return;
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
      void this._writeCriticalSystemLine('M5 S0', { trackSpindleMode: false }).catch(
        (err: unknown) =>
          console.warn(
            '[GrblController] T1-23 pause: M5 writeCritical failed; relying on feed-hold firmware contract:',
            err instanceof Error ? err.message : String(err),
          ),
      );
    }
  }

  /**
   * Resume a feed-hold pause. Only meaningful after pause().
   */
  resume(): void {
    if (!this._port?.isOpen) return;
    if (this._state.status !== 'hold' && !this._pausePending) return;
    // T1-23: pause() emitted M5. Reassert the captured modal spindle
    // mode with S0 before cycle-start so the resumed stream has the
    // expected M3/M4 mode without firing before motion resumes.
    if (this._lastSpindleMode && this._port?.isOpen) {
      const mode = this._lastSpindleMode;
      void this._writeCriticalSystemLine(`${mode} S0`, { trackSpindleMode: false }).catch(
        (err: unknown) =>
          console.warn(
            '[GrblController] T1-23 resume: spindle-mode reassert writeCritical failed:',
            err instanceof Error ? err.message : String(err),
          ),
      );
    }
    // Realtime `~` releases GRBL feed-hold; only continues streaming when a job is active.
    console.info('[GrblController] feed-hold release (~ / cycle-start)');
    this._sendRealtime(REALTIME_CYCLE_START);
    if (!this._isJobRunning) return;
    this._resumeRequested = true;
    this._pausePending = false;
    this._state.status = 'run';
    this._drainQueue();
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
  stop(): void {
    if (!this._port?.isOpen) return;
    console.info('[GrblController] stop() — soft reset, job aborted, re-home required');
    this._sendRealtime(REALTIME_RESET);
    this._abortJob();
    this._emitProgress();
  }

  /**
   * Emergency stop: soft reset + disconnect. Severs the command path so no further
   * commands can reach the machine without explicit reconnect.
   *
   * Use only for physical danger — fire, crash, runaway, user injury. For ordinary
   * "stop this job" use stop() instead.
   */
  emergencyStop(): void {
    if (!this._port?.isOpen) return;
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
  async safetyOff(): Promise<{
    stage: 'm5' | 'soft-reset' | 'failed';
    error?: Error;
  }> {
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
    // Defense-in-depth laser-off. Fire-and-forget; the error path that
    // produced the fault already issued one safetyOff. A second one
    // can't hurt and protects against the edge case where the prior
    // safetyOff was racing with new RX that re-modal-set M3.
    void this.safetyOff().then(result => {
      if (result.stage === 'failed') {
        console.warn(
          '[GrblController] T2-12: safetyOff during acknowledgeFault returned failed:',
          result.error,
        );
      }
    }).catch((err: unknown) => {
      console.warn('[GrblController] T2-12: safetyOff during acknowledgeFault threw:', err);
    });
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

  requestStatusReport(): void {
    if (!this._port?.isOpen) return;
    this._sendRealtime(REALTIME_STATUS);
  }

  /**
   * Trigger a machine autofocus macro/command and wait for a full motion cycle.
   * Resolves only after the machine leaves Idle (Home/Run) and then returns to Idle.
   */
  async runAutoFocus(command: string, timeoutMs: number = 15000): Promise<void> {
    if (!this._port?.isOpen) throw new Error('Not connected');
    if (this._state.status !== 'idle') throw new Error('Machine not idle — cannot auto-focus');
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
      let sawActiveState = false;
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
        void this.safetyOff().catch(() => { /* logged inside safetyOff */ });
        reject(new Error('Auto-focus timed out — safety-off attempted'));
      }, timeoutMs);

      const cleanup = (): void => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        unsubState();
        unsubRaw();
      };

      const unsubState = this.onStateChange((next) => {
        if (next.status === 'alarm') {
          cleanup();
          // T1-28: alarm during autofocus → safety-off before reject.
          void this.safetyOff().catch(() => { /* logged inside safetyOff */ });
          reject(new Error(`Auto-focus alarm: ALARM:${next.alarmCode ?? 'unknown'} — safety-off attempted`));
          return;
        }
        if (next.status === 'homing' || next.status === 'run') {
          sawActiveState = true;
          return;
        }
        if (sawActiveState && next.status === 'idle') {
          cleanup();
          resolve();
        }
      });
      const unsubRaw = this.onRawLine((line, direction) => {
        if (direction !== 'rx') return;
        if (!(line.startsWith('<') && line.endsWith('>'))) return;
        const token = line.slice(1, -1).split('|')[0]?.toLowerCase() ?? '';
        // Falcon firmware can emit non-standard states during $HZ1; treat any
        // non-idle/non-alarm status token as active so success doesn't false-timeout.
        if (token.length > 0 && token !== 'idle' && !token.startsWith('alarm')) {
          sawActiveState = true;
        }
      });

      try {
        this._writeLine(command);
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
    console.log(
      '[GRBL] Machine: ' +
        this._bedWidth +
        'x' +
        this._bedHeight +
        'mm, $23=' +
        this._homingDir +
        ', laser=' +
        this._laserMode
    );
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
    for (const cb of this._stateListeners) {
      cb({ ...this._state });
    }
  }

  private _tryParseG54WcsLine(line: string): void {
    const m = line.match(GRBL_G54_WCS_LINE);
    if (!m) return;
    const x = parseFloat(m[1]);
    const y = parseFloat(m[2]);
    const z = parseFloat(m[3]);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      this._currentG54 = { x, y, z };
    }
  }

  /**
   * T1-41: query GRBL for work-coordinate offsets via `$#` and resolve
   * with the freshly-parsed G54. Used by saved-origin verification at
   * Set Origin (snapshot) and at job start (compare). Returns `null`
   * if the controller is disconnected or the response did not parse
   * within the timeout.
   *
   * Implementation: clear `_currentG54` (tombstone), send `$#`, then
   * poll for `_currentG54` to repopulate when the next `[G54:x,y,z]`
   * line arrives. The timeout defaults to 1 second — generous for any
   * real GRBL response, short enough to avoid hanging the UI.
   */
  async requestWorkOffsets(timeoutMs = 1000): Promise<{ x: number; y: number; z: number } | null> {
    if (!this._port?.isOpen) return null;
    this._currentG54 = null;
    this._writeSystemLine('$#');
    const start = Date.now();
    return new Promise<{ x: number; y: number; z: number } | null>((resolve) => {
      const tick = (): void => {
        if (this._currentG54) {
          resolve(this._currentG54);
          return;
        }
        if (Date.now() - start >= timeoutMs) {
          resolve(null);
          return;
        }
        setTimeout(tick, 20);
      };
      tick();
    });
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
    const g54 = this._currentG54;
    const maskRaw = this._grblSettings.get(10);
    const parsed = maskRaw != null ? parseInt(maskRaw, 10) : 0;
    const mask = Number.isFinite(parsed) ? parsed : 0;

    const g54IsZero = g54
      ? Math.abs(g54.x) < 0.0005 && Math.abs(g54.y) < 0.0005 && Math.abs(g54.z) < 0.0005
      : true;
    const maskIsZero = mask === 0;

    if (g54IsZero && maskIsZero) {
      this.applyWcsNormalization();
      return;
    }

    this._emitWcsPayload(g54, mask);
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
        this._awaitingWcsQueryOk = false;
        this._currentG54 = null;
        this.skipWcsNormalization();
        return;
      }
      this._tryParseG54WcsLine(line);
      return;
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
      this._handleOk();
    } else if (line.startsWith('error:')) {
      this._handleError(line);
    } else if (line.startsWith('<') && line.endsWith('>')) {
      this._handleStatusReport(line);
    } else if (line.startsWith('ALARM:')) {
      this._handleAlarm(line);
    } else if (line.startsWith('Grbl')) {
      this._updateStatus('idle');
    } else if (this._parseDollarSetting(line)) {
      /* setting line outside active $$ dump — map already updated */
    }
  }

  private _handleOk(): void {
    if (this._pending.length === 0) return;

    const oldest = this._pending.shift()!;
    this._bufferAvailable += oldest.byteCount;
    if (!oldest.system) {
      this._linesAcknowledged++;
      this._recordAckTimestamp();
      this._emitProgress();
    }

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

    this._state.errorCode = code;
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
      void this.safetyOff().then(result => {
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
    void this.safetyOff().then(result => {
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
          this._queueIndex >= this._jobLines.length &&
          this._pending.length === 0)
      ) {
        this._abortJob();
        this._emitProgress();
      }
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
      this._positionConfirmed = true; // T1-44
    } else if (mPos) {
      this._state.position = mPos;
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

      const marker = this._lineMarkers[this._queueIndex];
      if (marker != null) {
        this._emitObjectLifecycle(marker);
      }

      this._writeLine(line);
      this._pending.push({ text: line, byteCount });
      this._bufferAvailable -= byteCount;
      this._queueIndex++;
      this._recordSendTimestamp();
    }
  }

  // ─── JOB LIFECYCLE ──────────────────────────────────────────

  private _completeJob(): void {
    this._isJobRunning = false;
    this._updateStatus('idle');
    this._emitProgress();
    this._lastLifecycleKey = null;
    this._emitObjectLifecycle([]);
  }

  private _abortJob(): void {
    this._isJobRunning = false;
    this._jobLines = [];
    this._lineMarkers = [];
    this._queueIndex = 0;
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
    const total = this._jobLines.length;
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
      this.requestStatusReport();
    }, STATUS_POLL_INTERVAL);
  }

  private _stopStatusPolling(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
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
    this._awaitingSettingsOk = true;
    this._writeSystemLine('$$');
  }

  /** Returns true if `line` was a `$N=value` setting (stored in `_grblSettings`). */
  private _parseDollarSetting(line: string): boolean {
    const m = line.match(GRBL_SETTING_LINE);
    if (!m) return false;
    const num = parseInt(m[1], 10);
    const rawVal = m[2].trim();
    this._grblSettings.set(num, rawVal);

    switch (num) {
      case 23:
        this._homingDir = parseInt(rawVal, 10) || 0;
        break;
      case 30: {
        const v = parseFloat(rawVal);
        if (Number.isFinite(v) && v > 0) {
          this._maxSpindle = v;
          for (const cb of this._stateListeners) {
            cb({ ...this._state });
          }
        }
        break;
      }
      case 32:
        this._laserMode = parseInt(rawVal, 10) !== 0;
        break;
      case 130: {
        const v = parseFloat(rawVal);
        if (Number.isFinite(v)) this._bedWidth = v;
        break;
      }
      case 131: {
        const v = parseFloat(rawVal);
        if (Number.isFinite(v)) this._bedHeight = v;
        break;
      }
      case 110: {
        const v = parseFloat(rawVal);
        if (Number.isFinite(v)) this._maxFeedX = v;
        break;
      }
      case 111: {
        const v = parseFloat(rawVal);
        if (Number.isFinite(v)) this._maxFeedY = v;
        break;
      }
      case 120: {
        const v = parseFloat(rawVal);
        if (Number.isFinite(v) && v > 0) this._maxAccelX = v;
        break;
      }
      case 121: {
        const v = parseFloat(rawVal);
        if (Number.isFinite(v) && v > 0) this._maxAccelY = v;
        break;
      }
      default:
        break;
    }
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
  private _classifySafeStateReason(): UnsafeAtConnectReason | null {
    const status = this._state.status;
    if (status === 'alarm') return 'alarm';
    if (status === 'run') return 'run';
    if (status === 'hold') return 'hold';
    if (status === 'check') return 'check';
    if (status === 'idle') {
      if (this._state.spindleSpeed !== 0 || this._state.feedRate !== 0) {
        return 'unsafe-residual-spindle';
      }
      return null;
    }
    // The 'door' GRBL status is intentionally not classified here: the
    // controller's status-map parser (in _handleStatusReport) doesn't
    // recognize the `<Door|...>` token today, so _state.status never
    // becomes 'door' even when the firmware reports it. If door support
    // is added to the parser, this classifier should also raise a
    // distinct reason. homing / connecting / disconnected / faulted →
    // no verdict (homing is a user-initiated startup cycle; faulted is
    // T2-12 territory and has its own gate).
    return null;
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
}
