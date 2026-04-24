import { type MutableRefObject } from 'react';
import { type MachineService } from './MachineService';
import { type LaserController } from '../controllers/ControllerInterface';
import { type Scene } from '../core/scene/Scene';
import { type MachineState } from '../controllers/ControllerInterface';
import { type ValidatedJobTicket } from '../core/job/ValidatedJobTicket';
import { type AABB } from '../core/types';
import { type MachineTransformOptions } from '../core/plan/MachineTransform';
import { buildFrameCorners, buildFrameGcode } from './frameGcode';
import { waitForGrblIdle } from './grblIdlePoll';

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
 * T2-4 migration: methods are moved here from ConnectionPanelMain in phases;
 * prefer calling named methods over {@link service}.
 */
export class ExecutionCoordinator {
  constructor(private readonly deps: ExecutionCoordinatorDeps) {}

  /**
   * @deprecated Remove by end of T2-4 — use specific coordinator methods. New call
   * sites should not depend on the full {@link MachineService} surface.
   */
  get service(): MachineService {
    return this.deps.machineService;
  }

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
  }): Promise<void> {
    return this.deps.machineService.startValidatedJob(args);
  }

  clearJobSession(): void {
    this.deps.machineService.clearJobSession();
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
}
