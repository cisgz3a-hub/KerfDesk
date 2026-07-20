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
): { readonly advisories: ReadonlyArray<string> } {
  // Frame-first (rule 7 / ADR-228): controller-capability findings are Job
  // Review advisories, never Start refusals. A current stock-GRBL build that
  // reports no M7 mist support is surfaced here so the operator sees it in Job
  // Review; the completed physical Frame remains the motion-safety authority.
  const m7 = evaluateM7AirAssistReadiness(
    gcode,
    machine.controllerBuildInfo ?? null,
    buildInfoObservationIsCurrent(machine),
  );
  return {
    advisories: [
      ...controller.errors.map((issue) => issue.message),
      ...(m7.kind === 'unsupported' || m7.kind === 'unknown' ? [m7.message] : []),
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
