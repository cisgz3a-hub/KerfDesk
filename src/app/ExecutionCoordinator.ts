import { type MachineService } from './MachineService';
import { type LaserController } from '../controllers/ControllerInterface';
import { type Scene } from '../core/scene/Scene';
import { type MachineState } from '../controllers/ControllerInterface';
import { type ValidatedJobTicket } from '../core/job/ValidatedJobTicket';

export interface ExecutionCoordinatorDeps {
  readonly machineService: MachineService;
  /** Current GRBL controller (may be stale if disconnect races; callers often re-read). */
  readonly getController: () => LaserController | null;
}

/**
 * Central entry for machine execution paths (jobs, jogging, streaming helpers).
 *
 * **T2-4 (phases 1–3 in one commit):** Thin facade over {@link MachineService};
 * jog, validated job start, and start-failure session clear route here. Later work
 * moves framing, test-fire, pause/stop orchestration, etc. behind this API.
 */
export class ExecutionCoordinator {
  constructor(private readonly deps: ExecutionCoordinatorDeps) {}

  /** Underlying service — still owns job logs, replay, wake lock, and port lifecycle. */
  get service(): MachineService {
    return this.deps.machineService;
  }

  /**
   * Jog one axis. Mirrors the connection panel contract: notify the simulator bus
   * with the exact `$J=` line, then delegate to {@link MachineService.jog}.
   */
  jog(
    axis: 'X' | 'Y',
    distance: number,
    feedRate: number,
    notifySimulatorTx: (line: string) => void,
  ): void {
    if (!this.deps.getController()) return;
    const cmd = `$J=G91 G21 ${axis}${distance} F${feedRate}`;
    notifySimulatorTx(cmd);
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
}
