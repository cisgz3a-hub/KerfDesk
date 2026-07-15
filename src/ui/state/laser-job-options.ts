import type { CreateStreamerOptions } from '../../core/controllers/grbl';
import type { MachineKind } from '../../core/scene';
import { normalizeGrblRxBufferBytes } from '../../core/grbl-streaming';
import type { CanvasMotionPlan } from './canvas-motion-plan';
import type { CncSetupAttestation } from './cnc-setup-attestation';
import type { CncToolPlanEntry } from './cnc-tool-plan';
import type { RunId } from './recovery';
import type { LaserModeStartEvidence } from './laser-mode-start-evidence';

export type StartJobOptions = CreateStreamerOptions & {
  /** Stable ownership for persistence; unrelated runs must never share progress. */
  readonly runId?: RunId;
  readonly machineKind?: MachineKind;
  readonly cncToolPlan?: ReadonlyArray<CncToolPlanEntry>;
  readonly cncSetupAttestation?: CncSetupAttestation;
  /** Session-bound $32 proof/acknowledgement supplied by operator-facing Starts. */
  readonly laserModeStartEvidence?: LaserModeStartEvidence;
  readonly canvasPlan?: CanvasMotionPlan;
};

export function normalizeStartJobOptions(options: CreateStreamerOptions): CreateStreamerOptions {
  return { ...options, rxBufferBytes: normalizeGrblRxBufferBytes(options.rxBufferBytes) };
}
