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
}

export interface FrameResult {
  ok: boolean;
  reason?: 'no-controller' | 'idle-timeout';
}

/**
 * Central entry for machine execution paths (jobs, jogging, framing, etc.).
 *
 * T2-4 migration: machine authority lives here; UI should call these methods
 * (or go through {@link MachineService} where appropriate) instead of emitting gcode
 * in components.
 */
export class ExecutionCoordinator {
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
   * Start test-fire: laser on at low power. Caller must have secured user consent (UI dialog)
   * and must set up a deadman timer — this method does NOT auto-stop. Pair with {@link endTestFire}
   * on pointer release or timeout.
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
      return true;
    } catch (err) {
      console.warn('[TestFire] start blocked:', err instanceof Error ? err.message : err);
      return false;
    }
  }

  /**
   * Immediate laser off (M5 S0). Notifies simulator. Idempotent-safe.
   * Swallows disconnect races ('Not connected').
   */
  async emergencyLaserOff(): Promise<void> {
    this.laserM5OffSync('[LaserOff] blocked:');
  }

  /** End test-fire: reuse emergency laser-off path. */
  async endTestFire(): Promise<void> {
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
