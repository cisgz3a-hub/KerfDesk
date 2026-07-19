import type { GrblBuildInfo } from '../../core/controllers/grbl/build-info';
import type { ControllerReadinessResult } from '../../core/preflight';
import { evaluateM7AirAssistReadiness } from '../../core/preflight/m7-air-assist-readiness';
import type { SessionObservationStamp } from '../state/laser-controller-observation';

export type StartControllerPolicyMachine = {
  readonly controllerSessionEpoch?: number;
  readonly controllerBuildInfo?: GrblBuildInfo | null;
  readonly controllerBuildInfoObservation?: SessionObservationStamp | null;
};

export function startControllerPolicy(
  controller: ControllerReadinessResult,
  gcode: string,
  machine: StartControllerPolicyMachine,
): { readonly blocking: ReadonlyArray<string>; readonly advisories: ReadonlyArray<string> } {
  // #296 makes controller-setting findings review advisories for both laser
  // and CNC output: the completed physical Frame remains the motion-safety
  // authority. A proven M7 incompatibility is different because the exact
  // emitted command would be rejected mid-program and Frame never sends M7.
  const m7 = evaluateM7AirAssistReadiness(
    gcode,
    machine.controllerBuildInfo ?? null,
    buildInfoObservationIsCurrent(machine),
  );
  return {
    blocking: m7.kind === 'unsupported' ? [m7.message] : [],
    advisories: [
      ...controller.errors.map((issue) => issue.message),
      ...(m7.kind === 'unknown' ? [m7.message] : []),
    ],
  };
}

function buildInfoObservationIsCurrent(machine: StartControllerPolicyMachine): boolean {
  const observation = machine.controllerBuildInfoObservation;
  return (
    observation !== null &&
    observation !== undefined &&
    machine.controllerSessionEpoch !== undefined &&
    observation.sessionEpoch === machine.controllerSessionEpoch
  );
}
