import type { CreateStreamerOptions } from '../../core/controllers/grbl';
import type { MachineKind } from '../../core/scene';
import { normalizeGrblRxBufferBytes } from '../../core/grbl-streaming';
import type { CanvasMotionPlan } from './canvas-motion-plan';
import type { CncSetupAttestation } from './cnc-setup-attestation';
import type { CncToolPlanEntry } from './cnc-tool-plan';

export type StartJobOptions = CreateStreamerOptions & {
  readonly machineKind?: MachineKind;
  readonly cncToolPlan?: ReadonlyArray<CncToolPlanEntry>;
  readonly cncSetupAttestation?: CncSetupAttestation;
  readonly canvasPlan?: CanvasMotionPlan;
};

export function normalizeStartJobOptions(options: CreateStreamerOptions): CreateStreamerOptions {
  return { ...options, rxBufferBytes: normalizeGrblRxBufferBytes(options.rxBufferBytes) };
}
