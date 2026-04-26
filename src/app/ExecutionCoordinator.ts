import { type MutableRefObject } from 'react';
import { type MachineService } from './MachineService';
import { type LaserController } from '../controllers/ControllerInterface';
import { type Scene } from '../core/scene/Scene';
import { type MachineState } from '../controllers/ControllerInterface';
import { type ValidatedJobTicket } from '../core/job/ValidatedJobTicket';
import { type ActiveJobCanvasContext } from './ActiveJobCanvasContext';
import { type AABB } from '../core/types';
import { type MachineTransformOptions } from '../core/plan/MachineTransform';
import { buildFrameCorners, buildFrameGcode } from './frameGcode';
import { waitForGrblIdle } from './grblIdlePoll';
import { sendSetOriginWcsCommand } from './sendSetOriginWcsCommand';

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
  reason?: 'no-controller' | 'idle-timeout';
}

/**
 * Hardware-off deadman duration for test-fire. After this many milliseconds the
 * coordinator forces {@link ExecutionCoordinator.emergencyLaserOff} regardless of
 * whether the UI requested a stop. T1-18: this guarantee lives in the service so
 * a hung renderer / lost pointer-capture / unmounted component cannot strand the
 * laser on. The UI's pointer-up handler is a UX convenience, not a safety guarantee.
 */
export const TEST_FIRE_DEADMAN_MS = 5000;

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

  jog(axis: 'X' | 'Y', distance: number, feedRate: number): void {
    if (!this.deps.controllerRef.current) return;
    const cmd = `$J=G91 G21 ${axis}${distance} F${feedRate}`;
    this.notifySimulator(cmd);
    this.deps.machineService.jog(axis, distance, feedRate);
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
    return this.deps.machineService.autoFocus();
  }

  /** Unlock GRBL ($X). Caller must run danger confirmation when appropriate. */
  async unlock(): Promise<void> {
    if (!this.deps.controllerRef.current) return;
    this.notifySimulator('$X');
    await this.deps.machineService.sendCommand('$X', 'user');
  }

  /** Home ($H). Caller must confirm the user intends to home. */
  async home(): Promise<void> {
    if (!this.deps.controllerRef.current) return;
    this.notifySimulator('$H');
    await this.deps.machineService.sendCommand('$H', 'user');
  }

  /** Frame without firing the laser (rapid moves only). */
  async frameSafe(args: {
    sceneBounds: AABB;
    transformOpts: MachineTransformOptions;
    idleTimeoutMs?: number;
  }): Promise<FrameResult> {
    return this.runFrame({
      sceneBounds: args.sceneBounds,
      transformOpts: args.transformOpts,
      laserMode: 'off',
      idleTimeoutMs: args.idleTimeoutMs,
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
  }): Promise<FrameResult> {
    return this.runFrame({
      sceneBounds: args.sceneBounds,
      transformOpts: args.transformOpts,
      laserMode: 'dot',
      maxSpindle: args.maxSpindle,
      idleTimeoutMs: args.idleTimeoutMs,
    });
  }

  private async runFrame(args: {
    sceneBounds: AABB;
    transformOpts: MachineTransformOptions;
    laserMode: 'off' | 'dot';
    maxSpindle?: number;
    idleTimeoutMs?: number;
  }): Promise<FrameResult> {
    const ctrl = this.deps.controllerRef.current;
    if (!ctrl) return { ok: false, reason: 'no-controller' };

    const { sceneBounds, transformOpts, laserMode, maxSpindle = 1000 } = args;
    const corners = buildFrameCorners(sceneBounds, transformOpts);
    const lines = buildFrameGcode(corners, {
      startMode: transformOpts.startMode,
      laserMode,
      maxSpindle,
    });

    for (const line of lines) {
      this.notifySimulator(line);
      try {
        ctrl.sendCommand(line, 'internal');
      } catch (err: unknown) {
        console.warn('[Command blocked]', err instanceof Error ? err.message : err);
      }
      await new Promise(r => setTimeout(r, 50));
    }

    const idleOk = await waitForGrblIdle(ctrl, args.idleTimeoutMs);
    if (!idleOk) return { ok: false, reason: 'idle-timeout' };

    return { ok: true };
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
    const sVal = Math.max(0, Math.round((2 / 100) * args.maxSpindle));
    const cmd = `M3 S${sVal}`;
    this.notifySimulator(cmd);
    try {
      ctrl.sendCommand(cmd, 'internal');
    } catch (err) {
      console.warn('[TestFire] start blocked:', err instanceof Error ? err.message : err);
      return false;
    }
    // Arm the deadman synchronously after the M3 succeeds so there is no window
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
      void this.emergencyLaserOff();
    }, deadmanMs);
    return true;
  }

  /**
   * Immediate laser off (M5 S0). Notifies simulator. Idempotent-safe.
   * Swallows disconnect races ('Not connected').
   */
  async emergencyLaserOff(): Promise<void> {
    this.laserM5OffSync('[LaserOff] blocked:');
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
    await this.emergencyLaserOff();
  }

  private laserM5OffSync(warnPrefix: string): void {
    const ctrl = this.deps.controllerRef.current;
    const cmd = 'M5 S0';
    this.notifySimulator(cmd);
    if (!ctrl) return;
    try {
      ctrl.sendCommand(cmd, 'internal');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('Not connected')) {
        console.warn(warnPrefix, msg);
      }
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
  async setOriginAtCurrentPosition(): Promise<void> {
    const ctrl = this.deps.controllerRef.current;
    if (!ctrl) return;
    this.notifySimulator('G10 L20 P1 X0 Y0');
    sendSetOriginWcsCommand(ctrl);
  }
}
