import type { ControllerProfile } from './ControllerProfile';
import { MachineCommandLog } from './MachineCommandLog';
import type { MachineIntent, MachineOperationResult } from './MachineIntent';
import { planGrblJog } from './grbl/GrblJog';
import { GRBL_REALTIME } from './grbl/GrblRealtime';

export interface MachineOperationDeps {
  readonly sendLine: (line: string) => Promise<void>;
  readonly sendRealtime: (char: string) => Promise<void>;
}

const defaultProfile: ControllerProfile = {
  family: 'grbl',
  firmwareVersion: '1.1h',
  softLimitsEnabled: false,
  homingEnabled: false,
  laserModeEnabled: true,
  spindleMin: 0,
  spindleMax: 1000,
  travelMm: { X: null, Y: null, Z: null, A: null },
  maxFeedMmPerMin: { X: null, Y: null, Z: null, A: null },
  supportsRealtime: true,
  supportsJogCancel: true,
};

export class MachineOperationService {
  readonly log = new MachineCommandLog();

  constructor(
    private readonly deps: MachineOperationDeps,
    private readonly profile: ControllerProfile = defaultProfile,
  ) {}

  async jog(
    intent: Extract<MachineIntent, { kind: 'jog' }>,
  ): Promise<MachineOperationResult> {
    const planned = planGrblJog({
      profile: this.profile,
      axis: intent.axis,
      distanceMm: intent.distanceMm,
      feedMmPerMin: intent.feedMmPerMin,
      absolute: false,
    });

    if (!planned.accepted) {
      return this.rejected('jog', planned.reason ?? 'Jog rejected.');
    }

    await this.deps.sendLine(planned.command);
    this.log.add('tx', planned.command);
    return this.accepted('jog', [planned.command], false);
  }

  async pause(): Promise<MachineOperationResult> {
    await this.deps.sendRealtime(GRBL_REALTIME.feedHold);
    this.log.add('tx-realtime', 'feedHold');
    return this.accepted('pauseJob', [GRBL_REALTIME.feedHold], false);
  }

  async resume(): Promise<MachineOperationResult> {
    await this.deps.sendRealtime(GRBL_REALTIME.cycleStart);
    this.log.add('tx-realtime', 'cycleStart');
    return this.accepted('resumeJob', [GRBL_REALTIME.cycleStart], false);
  }

  async stop(reason: string): Promise<MachineOperationResult> {
    await this.deps.sendLine('M5');
    await this.deps.sendRealtime(GRBL_REALTIME.softReset);
    this.log.add('tx', `M5 then softReset: ${reason}`);

    return {
      accepted: true,
      intent: 'stopJob',
      emittedCommands: ['M5', GRBL_REALTIME.softReset],
      positionTrust: 'untrusted',
      laserOutputTrust: 'unknown',
      requiresRehome: true,
    };
  }

  private accepted(
    intent: MachineOperationResult['intent'],
    emittedCommands: readonly string[],
    requiresRehome: boolean,
  ): MachineOperationResult {
    return {
      accepted: true,
      intent,
      emittedCommands,
      positionTrust: 'trusted',
      laserOutputTrust: 'trusted',
      requiresRehome,
    };
  }

  private rejected(
    intent: MachineOperationResult['intent'],
    reason: string,
  ): MachineOperationResult {
    return {
      accepted: false,
      intent,
      emittedCommands: [],
      reason,
      positionTrust: 'unknown',
      laserOutputTrust: 'unknown',
      requiresRehome: 'unknown',
    };
  }
}
