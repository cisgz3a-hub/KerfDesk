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

export class GrblController implements LaserController {
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
  get maxSpindle(): number | null { return this._maxSpindle; }

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

        const isWelcome =
          line.toLowerCase().includes('grbl') ||
          line.startsWith('[VER:') ||
          line.startsWith('[MSG:') ||
          isGrblStatusWelcome ||
          line === 'ok';

        if (!welcomeReceived && isWelcome) {
          welcomeReceived = true;
          clearTimeout(timeout);
          clearProbeTimers();
          // Never claim idle if the controller is already in motion (avoids overlapping streams).
          this._updateStatus(statusWelcome ?? 'idle');
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
            try { this._port.close(); } catch { /* ignore */ }
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
        this._port.close();
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
    this._grblSettings.clear();
    this._resetMachineSettingsCache();
    this._updateStatus('disconnected');
  }

  // ─── JOB EXECUTION ──────────────────────────────────────────

  sendJob(lines: string[]): void {
    if (!this._port?.isOpen) throw new Error('Not connected');
    if (this._isJobRunning) throw new Error('Job already running');
    if (this._state.status !== 'idle') {
      throw new Error(
        `Cannot start job — machine is "${this._state.status}" (stop or reset on the controller until idle, then try again)`,
      );
    }

    {
      const jobLines: string[] = [];
      const lineMarkers: (readonly string[] | null)[] = [];
      let pending: readonly string[] | null = null;
      for (const raw of lines) {
        const line = raw.trim();
        if (line.length === 0) continue;
        if (line.startsWith(';')) {
          const m = line.match(/^;\s*OBJ\s+ids=(.+)$/i);
          if (m) {
            const parsed = m[1].split(',').map(s => s.trim()).filter(s => s.length > 0);
            pending = parsed;
          }
          continue;
        }
        jobLines.push(line);
        lineMarkers.push(pending);
        pending = null;
      }
      this._jobLines = jobLines;
      this._lineMarkers = lineMarkers;
    }

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
    this._sendRealtime(REALTIME_FEED_HOLD);
  }

  /**
   * Resume a feed-hold pause. Only meaningful after pause().
   */
  resume(): void {
    if (!this._port?.isOpen) return;
    if (this._state.status !== 'hold' && !this._pausePending) return;
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
   * EMERGENCY stop only. Sends soft reset. Position may be lost (e.g. ALARM:3).
   * Machine must be unlocked + rehomed before the next job.
   * Use only for physical danger — fire, crash, runaway.
   */
  emergencyStop(): void {
    if (!this._port?.isOpen) return;
    console.warn('[GrblController] EMERGENCY STOP — soft reset, position may be lost, rehome may be required');
    this._sendRealtime(REALTIME_RESET);
    this._abortJob();
    this._emitProgress();
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
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Auto-focus timed out'));
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
          reject(new Error(`Auto-focus alarm: ALARM:${next.alarmCode ?? 'unknown'}`));
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
      console.warn(
        '[GrblController] onWcsConsentNeeded would fire with no listeners — applying WCS normalization without user prompt. '
        + 'This is expected in headless tests; if a UI is expected, subscribe before connect or there is a race.',
      );
      this.applyWcsNormalization();
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
    this._linesAcknowledged++;
    this._recordAckTimestamp();
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
      this._recordAckTimestamp();

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
   * GRBL $22: homing cycle enable. `true` if $22=1, `false` if $22=0, `undefined` if not in $$ cache.
   */
  getFirmwareHomingCycleEnabled(): boolean | undefined {
    if (!this._grblSettings.has(22)) return undefined;
    const v = this._grblSettings.get(22)!.trim();
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return undefined;
    return n !== 0;
  }
}
