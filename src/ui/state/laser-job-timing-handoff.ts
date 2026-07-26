import type { GcodeTimingPlanResult } from '../../core/gcode-time';
import { reportedWorkPositionMm } from './canvas-motion-plan';
import { validatedCanvasJobTimingPlan } from './canvas-job-timing-plan';
import type { StartJobOptions } from './laser-job-options';
import type { LaserState } from './laser-store';

/**
 * Revalidates the timing plan against the exact emitted program and current
 * controller/session evidence, downgrading drift or missing proof to an
 * unavailable estimate without changing Start authorization.
 */
export function validatedStartJobTimingPlan(
  gcode: string,
  options: StartJobOptions,
  state: LaserState,
): GcodeTimingPlanResult | undefined {
  return validatedCanvasJobTimingPlan(gcode, options.jobTimingPlan, {
    controllerSessionEpoch: state.controllerSessionEpoch,
    positionEpoch: state.trustedPositionEpoch,
    activeControllerKind: state.activeControllerKind,
    detectedControllerKind: state.detectedControllerKind,
    initialPosition: reportedWorkPositionMm(state, state.controllerSettings?.reportInches === true),
  });
}
