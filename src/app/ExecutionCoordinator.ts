import { type MutableRefObject } from 'react';
import { type MachineService, type ActiveOperationKind } from './MachineService';
import { type LaserController } from '../controllers/ControllerInterface';
import { type Scene } from '../core/scene/Scene';
import { type MachineState } from '../controllers/ControllerInterface';
import { type ValidatedJobTicket } from '../core/job/ValidatedJobTicket';
import { type ActiveJobCanvasContext } from './ActiveJobCanvasContext';
import { type AABB } from '../core/types';
import { type MachineTransformOptions } from '../core/plan/MachineTransform';
import { buildFrameCorners } from './frameGcode';
import { waitForGrblIdle } from './grblIdlePoll';
import { MachineCommandGateway } from './MachineCommandGateway';

export type { MachineTransformOptions as MachineTransformOpts } from '../core/plan/MachineTransform';

export interface ExecutionCoordinatorDeps {
  readonly machineService: MachineService;
  /**
   * Same ref as {@link MachineService}'s controller ref (single source of truth).
   */
  readonly controllerRef: MutableRefObject<LaserController | null>;
  readonly notifySimulatorRef: MutableRefObject<(line: string) => void>;
  /**
   * Override the test-fire deadman duration. Production should leave this undefined
   * (defaults to {@link TEST_FIRE_DEADMAN_MS}). Tests may inject a smaller value to
   * exercise the auto-stop without waiting 5 real seconds.
   */
  readonly testFireDeadmanMs?: number;
}

export interface FrameResult {
  ok: boolean;
  /**
   * When `ok` is false, the reason the frame did not complete cleanly.
   *
   * - 'no-controller': no controller connection at the moment frameSafe was called.
   * - 'idle-timeout': GRBL did not report idle within the timeout.
   * - 'command-blocked': command emission threw partway through corner streaming.
   *   A subset of frame commands may have physically executed; the rest did not.
   * - 'operation-busy' (T2-11): another machine operation (test-fire, autofocus,
   *   set-origin, jog, or another frame) holds the service-layer mutex. Caller
   *   should wait for that operation to complete and retry.
   */
  reason?: 'no-controller' | 'idle-timeout' | 'command-blocked' | 'operation-busy';
  /**
   * T1-103: when `reason === 'command-blocked'`, the original error message
   * surfaced to the UI for the messages console. Empty string if no message
   * could be extracted.
   */
  blockedError?: string;
  /**
   * T1-103: when `reason === 'command-blocked'`, the zero-indexed
   * corner-stream line that threw.
   */
  blockedAtLine?: number;
}

/**
 * Hardware-off deadman duration for test-fire. After this many milliseconds the
 * coordinator forces {@link ExecutionCoordinator.emergencyLaserOff} regardless of
 * whether the UI requested a stop. T1-18: this guarantee lives in the service so
 * a hung renderer / lost pointer-capture / unmounted component cannot strand the
 * laser on. The UI's pointer-up handler is a UX convenience, not a safety guarantee.
 */
export const TEST_FIRE_DEADMAN_MS = 5000;
export const TEST_FIRE_POWER_PERCENT = 5;

/**
 * Test-fire is a stationary burn. GRBL dynamic mode (M4) may energize fans
 * while suppressing beam output until motion starts, so use constant-power M3
 * for the held focus/test pulse and always pair it with M5 on release/deadman.
 */
export const TEST_FIRE_LASER_ON_WORD = 'M3';

/**
 * Central entry for machine execution paths (jobs, jogging, framing, etc.).
 *
 * T2-4 migration: machine authority lives here; UI should call these methods
 * (or go through {@link MachineService} where appropriate) instead of emitting gcode
 * in components.
 */
export class ExecutionCoordinator {
  /**
   * Service-owned test-fire deadman timer handle. Non-null while a test-fire is
   * armed; cleared synchronously before any laser-off path so a re-entrant
   * stop cannot race with the timer's own laser-off. T1-18.
   */
  private _testFireTimerHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: ExecutionCoordinatorDeps) {}

  private notifySimulator(line: string): void {
    this.deps.notifySimulatorRef.current(line);
  }

  private getCommandGateway(ctrl: LaserController | null = this.deps.controllerRef.current): MachineCommandGateway | null {
    return ctrl ? new MachineCommandGateway(ctrl) : null;
  }

  async jog(axis: 'X' | 'Y', distance: number, feedRate: number): Promise<{ ok: boolean; reason?: string }> {
    const ctrl = this.deps.controllerRef.current;
    if (!ctrl) return { ok: false, reason: 'no-controller' };
    // T2-11: jog acquires the operation mutex for the duration of the
    // synchronous send. Sequential jogs (arrow-key spam) acquire and
    // release per call — no contention. The mutex prevents jog from
    // interleaving with test-fire / frame-dot / autoFocus, which
    // matters because all of those issue motion + modal-state commands
    // that would race on GRBL's command queue.
    if (!this.deps.machineService.tryAcquireOperation('jog')) {
      return { ok: false, reason: 'operation-busy' };
    }
    try {
      const cmd = `$J=G91 G21 ${axis}${distance} F${feedRate}`;
      this.notifySimulator(cmd);
      try {
        const result = await ctrl.operations.jog({ axis, distanceMm: distance, feedMmPerMin: feedRate });
        if (!result.ok) return { ok: false, reason: result.reason };
      } catch (err: unknown) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) };
      }
      setTimeout(() => {
        try {
          ctrl.requestStatusReport();
        } catch {
          /* ignore */
        }
      }, 100);
      return { ok: true };
    } finally {
      this.deps.machineService.releaseOperation('jog');
    }
  }

  async startValidatedJob(args: {
    ticket: ValidatedJobTicket;
    scene: Scene;
    machineState: MachineState | null;
    notifySimulatorTx: (line: string) => void;
    canvasContext: ActiveJobCanvasContext;
  }): Promise<void> {
    return this.deps.machineService.startValidatedJob(args);
  }

  clearJobSession(): void {
    this.deps.machineService.clearJobSession();
  }

  /**
   * Auto-focus sequence. Delegates to {@link MachineService.autoFocus} which checks profile
   * support, controller capability, and timeout before invoking {@link LaserController.runAutoFocus}.
   *
   * UI should still gate on `activeProfile.autoFocusSupported` and machine idle state before
   * calling — the coordinator executes only; it does not enforce pre-conditions.
   */
  async autoFocus(): Promise<{ ok: true } | { ok: false; error: string }> {
    // T2-11: acquire the mutex for the autoFocus duration. The
    // controller's runAutoFocus uses a probe-pin sequence that conflicts
    // with any other modal-state mutation (test-fire's M3, frame-dot's
    // M4, set-origin's G10). The mutex prevents those from racing.
    if (!this.deps.machineService.tryAcquireOperation('autoFocus')) {
      return { ok: false, error: 'Another machine operation is in progress.' };
    }
    try {
      return await this.deps.machineService.autoFocus();
    } finally {
      this.deps.machineService.releaseOperation('autoFocus');
    }
  }

  /** Unlock GRBL ($X). Caller must run danger confirmation before invoking this. */
  async unlock(): Promise<void> {
    const ctrl = this.deps.controllerRef.current;
    if (!ctrl) return;
    this.notifySimulator('$X');
    const result = await ctrl.operations.unlockAlarm();
    if (!result.ok) throw new Error(result.reason);
  }

  /** Home ($H). Caller must confirm the user intends to home before invoking this. */
  async home(): Promise<void> {
    const ctrl = this.deps.controllerRef.current;
    if (!ctrl) return;
    this.notifySimulator('$H');
    const result = await ctrl.operations.home();
    if (!result.ok) throw new Error(result.reason);
  }

  /** Frame without firing the laser (rapid moves only). */
  async frameSafe(args: {
    sceneBounds: AABB;
    transformOpts: MachineTransformOptions;
    idleTimeoutMs?: number;
    withCrosshair?: boolean;
  }): Promise<FrameResult> {
    return this.runFrame({
      sceneBounds: args.sceneBounds,
      transformOpts: args.transformOpts,
      laserMode: 'off',
      idleTimeoutMs: args.idleTimeoutMs,
      withCrosshair: args.withCrosshair ?? true,
    });
  }

  /**
   * Frame with low-power laser on during cutting moves. Caller must obtain
   * laser-dot consent in the UI before invoking.
   */
  async frameDot(args: {
    sceneBounds: AABB;
    transformOpts: MachineTransformOptions;
    maxSpindle: number;
    idleTimeoutMs?: number;
    withCrosshair?: boolean;
  }): Promise<FrameResult> {
    return this.runFrame({
      sceneBounds: args.sceneBounds,
      transformOpts: args.transformOpts,
      laserMode: 'dot',
      maxSpindle: args.maxSpindle,
      idleTimeoutMs: args.idleTimeoutMs,
      withCrosshair: args.withCrosshair ?? true,
    });
  }

  private async runFrame(args: {
    sceneBounds: AABB;
    transformOpts: MachineTransformOptions;
    laserMode: 'off' | 'dot';
    maxSpindle?: number;
    idleTimeoutMs?: number;
    withCrosshair?: boolean;
  }): Promise<FrameResult> {
    const ctrl = this.deps.controllerRef.current;
    if (!ctrl) return { ok: false, reason: 'no-controller' };
    // T2-11: acquire the mutex BEFORE any side-effect (notifySimulator,
    // sendCommand, motion). frame-off and frame-dot use distinct kinds
    // because the spec lists them separately and the gate semantics
    // differ (frame-off doesn't fire the laser; frame-dot does at low
    // power). Mutex held across the entire corner-stream + idle-wait
    // span, plus across the laser-off finally for frame-dot.
    const opKind: ActiveOperationKind = args.laserMode === 'dot' ? 'frameDot' : 'frame';
    if (!this.deps.machineService.tryAcquireOperation(opKind)) {
      return { ok: false, reason: 'operation-busy' };
    }

    const { sceneBounds, transformOpts, laserMode, maxSpindle = 1000, withCrosshair = false } = args;
    const corners = buildFrameCorners(sceneBounds, transformOpts);

    // T1-21: frame-dot emits M4 before the final M5. If the streaming
    // sequence returns early (T1-103 command-blocked) or throws before
    // the trailing M5, force the laser modal state off before returning.
    try {
      const frameResult = await ctrl.operations.frame({
        corners,
        startMode: transformOpts.startMode,
        laserMode,
        maxSpindle,
        crosshairAfterFrame: withCrosshair,
        onCommand: line => this.notifySimulator(line),
        lineDelayMs: 50,
      });
      if (!frameResult.ok) {
        const msg = frameResult.message ?? frameResult.reason;
        console.warn('[Command blocked]', msg);
        return {
          ok: false,
          reason: 'command-blocked',
          blockedError: msg,
          blockedAtLine: frameResult.blockedAtLine,
        };
      }

      const idleOk = await waitForGrblIdle(ctrl, args.idleTimeoutMs);
      if (!idleOk) return { ok: false, reason: 'idle-timeout' };

      return { ok: true };
    } finally {
      if (laserMode === 'dot') {
        try {
          await this.emergencyLaserOff();
        } catch (err) {
          console.warn('[FrameDot] emergencyLaserOff in finally failed:', err instanceof Error ? err.message : err);
        }
      }
      // T2-11: release after the laser-off finally so the mutex stays
      // held across the entire frame operation including its safety
      // teardown. Releasing earlier would let another operation begin
      // before emergencyLaserOff finishes.
      this.deps.machineService.releaseOperation(opKind);
    }
  }

  /**
   * Start test-fire: laser on at low power. T1-18: this method owns the deadman.
   * On successful start, a service-owned timer is armed for {@link TEST_FIRE_DEADMAN_MS}
   * (or the test-injected override) and will force a laser-off if {@link endTestFire}
   * is not called first. UI pointer-up / pointer-cancel / unmount handlers should still
   * call {@link endTestFire} for responsive UX, but they are no longer the safety guarantee.
   *
   * Returns false if no controller (caller should not set isTestFiring UI state in that case).
   */
  async beginTestFire(args: { maxSpindle: number }): Promise<boolean> {
    const ctrl = this.deps.controllerRef.current;
    if (!ctrl) return false;
    // T2-11: acquire the mutex before issuing the M3 + arming the deadman.
    // Re-entry: same-kind acquire returns true (preserves the existing
    // "second beginTestFire resets the timer" semantics — the spec
    // already wanted that behavior). Different-kind acquire fails;
    // beginTestFire returns false same as no-controller.
    if (!this.deps.machineService.tryAcquireOperation('testFire')) {
      return false;
    }
    const sVal = Math.max(0, Math.round((TEST_FIRE_POWER_PERCENT / 100) * args.maxSpindle));
    const cmd = `${TEST_FIRE_LASER_ON_WORD} S${sVal}`;
    this.notifySimulator(cmd);
    const result = await ctrl.operations.testFire({
      powerPercent: TEST_FIRE_POWER_PERCENT,
      maxSpindle: args.maxSpindle,
    });
    if (!result.ok) {
      console.warn('[TestFire] start blocked:', result.message ?? result.reason);
      // T2-11: release on failed start. The mutex is only useful if it's
      // actually freed when the operation didn't begin.
      this.deps.machineService.releaseOperation('testFire');
      return false;
    }
    // T1-22: notify the service that the laser is intentionally on so
    // job-start gates and the laser-output-state surface stay accurate.
    this.deps.machineService.notifyTestFire('begin');
    // Arm the deadman synchronously after the laser-on command succeeds so there is no window
    // in which the laser is on but the auto-stop is unscheduled. Re-entry: clear
    // any prior handle first (a second beginTestFire resets the timer).
    if (this._testFireTimerHandle !== null) {
      clearTimeout(this._testFireTimerHandle);
      this._testFireTimerHandle = null;
    }
    const deadmanMs = this.deps.testFireDeadmanMs ?? TEST_FIRE_DEADMAN_MS;
    this._testFireTimerHandle = setTimeout(() => {
      // Clear handle *before* firing the laser-off so a re-entrant endTestFire
      // during the M5 write does not see a stale handle. T1-18.
      this._testFireTimerHandle = null;
      console.warn('[TestFire] deadman expired — forcing laser off');
      // T1-22: deadman path also notifies test-fire end so the service's
      // laser-output-state transitions back to 'off' (or 'unknown' if the
      // safetyOff path took the soft-reset fallback).
      this.deps.machineService.notifyTestFire('end');
      // T2-11: deadman release pairs with beginTestFire's acquire. The
      // .finally chain ensures release fires whether emergencyLaserOff
      // resolves or rejects. releaseOperation is idempotent in case
      // endTestFire raced ahead of the deadman.
      void this.emergencyLaserOff().finally(() => {
        this.deps.machineService.releaseOperation('testFire');
      });
    }, deadmanMs);
    return true;
  }

  /**
   * Two-stage hardware-off path. T1-22.
   *
   * Awaits {@link LaserController.safetyOff}, which tries `M5 S0` via the
   * port's awaitable critical-write and, on transport failure, falls back to
   * soft reset (`0x18`). Pipes the structured outcome to
   * {@link MachineService.notifyLaserSafetyOutcome} so subsequent job starts
   * are gated until laser-output state is trustworthy again.
   *
   * Warning text is preserved for back-compat with existing tests that assert
   * on `[LaserOff] blocked:`. A new `[LaserOff] M5 transport failed; soft
   * reset succeeded` warn marks the fallback path so support bundles can
   * distinguish it.
   */
  async emergencyLaserOff(): Promise<void> {
    const ctrl = this.deps.controllerRef.current;
    this.notifySimulator('M5 S0');
    if (!ctrl) return;
    const result = await ctrl.operations.laserOff({ emergency: true });
    const stage = result.ok ? 'm5' : result.reason === 'soft-reset' ? 'soft-reset' : 'failed';
    const message = result.ok ? '' : result.message ?? result.reason;
    this.deps.machineService.notifyLaserSafetyOutcome(stage);
    if (stage === 'm5') return;
    if (stage === 'soft-reset') {
      console.warn(
        '[LaserOff] M5 transport failed; soft reset succeeded:',
        message,
      );
      return;
    }
    // stage === 'failed'
    const msg = message || 'unknown';
    if (!msg.includes('Not connected')) {
      console.warn('[LaserOff] blocked:', msg);
    }
  }

  /**
   * End test-fire: disarm the deadman, then issue M5. Order matters — disarm
   * before laser-off so a slow {@link emergencyLaserOff} cannot race with the
   * timer firing again. Idempotent: safe to call without an active fire. T1-18.
   */
  async endTestFire(): Promise<void> {
    if (this._testFireTimerHandle !== null) {
      clearTimeout(this._testFireTimerHandle);
      this._testFireTimerHandle = null;
    }
    // T1-22: notify the service that the user-driven laser-on phase is over.
    // The subsequent emergencyLaserOff will further refine the state via
    // notifyLaserSafetyOutcome (M5 → 'off', soft-reset/failed → 'unknown').
    this.deps.machineService.notifyTestFire('end');
    try {
      await this.emergencyLaserOff();
    } finally {
      // T2-11: release after the laser-off attempt regardless of outcome.
      // releaseOperation is idempotent — if the deadman raced ahead and
      // already released, this is a no-op. Holding the mutex through
      // emergencyLaserOff prevents another operation from starting
      // while M5 / soft-reset is still in flight.
      this.deps.machineService.releaseOperation('testFire');
    }
  }

  /**
   * Stop (if requested), laser off, then {@link MachineService.disconnect} (wake-lock release +
   * controller disconnect + port clear). No-op if already disconnected.
   *
   * @param options.skipStop — omit controller {@link LaserController.stop} (e.g. toolbar
   *   disconnect while idle). GRBL `stop()` is a soft reset; skipping avoids alarm/rehome.
   */
  async safeDisconnect(options?: { skipStop?: boolean }): Promise<void> {
    const ctrl = this.deps.controllerRef.current;
    if (!ctrl) return;

    const status = ctrl.state.status;
    if (status === 'disconnected' || status === 'connecting') return;

    if (!options?.skipStop) {
      try {
        ctrl.stop();
      } catch {
        /* port may already be gone */
      }
    }
    try {
      await this.deps.machineService.disconnect();
    } catch (err) {
      console.warn('[Disconnect] failed:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * Set machine origin: zero the G54 work coordinate at the current physical head position.
   * Caller must have verified the head is at the intended position.
   */
  async setOriginAtCurrentPosition(): Promise<{ ok: boolean; reason?: string }> {
    const ctrl = this.deps.controllerRef.current;
    if (!ctrl) return { ok: false, reason: 'no-controller' };
    // T2-11: acquire the mutex around set-origin. The G10 L20 modal-state
    // mutation must not race with frame-dot's M4, test-fire's M3, or
    // autoFocus's probe sequence — any of those could land between the
    // simulator notify and the actual sendCommand and corrupt the
    // resulting WCS state.
    if (!this.deps.machineService.tryAcquireOperation('setOrigin')) {
      return { ok: false, reason: 'operation-busy' };
    }
    try {
      this.notifySimulator('G10 L20 P1 X0 Y0');
      return ctrl.operations.setWorkOriginAtCurrentPosition();
    } finally {
      this.deps.machineService.releaseOperation('setOrigin');
    }
  }
}
