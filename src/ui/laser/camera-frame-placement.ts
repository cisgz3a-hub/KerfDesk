import type { Project } from '../../core/scene';
import {
  resolveJobPlacement,
  type JobPlacementSettings,
  type MachinePlacementSnapshot,
  type ResolvedJobPlacement,
} from '../job-placement';
import type { HomingState, LaserState } from '../state/laser-store';

type CameraFrameMachineSnapshot = MachinePlacementSnapshot & {
  readonly homingState: HomingState;
  readonly trustedPositionEpoch: number | undefined;
};

export function resolveCameraSafeFramePlacement(
  project: Project,
  jobPlacement: JobPlacementSettings,
  machine: CameraFrameMachineSnapshot,
): ResolvedJobPlacement {
  // Frame is the physical placement authority. Camera alignment, Home state,
  // and manual position confirmation may inform the review, but they do not
  // veto a tool-off trace the operator can directly watch. The exact artifact
  // captures compiled placement and origin, not later camera-only UI state.
  void project;
  return resolveJobPlacement(jobPlacement, machine);
}

/** The ordinary Frame's placement against live controller evidence. The Frame
 * resolves it before compiling, and the pre-Frame fix offers ask the same
 * question first, so both read one set of inputs. */
export function resolveLiveFramePlacement(
  app: { readonly project: Project; readonly jobPlacement: JobPlacementSettings },
  laser: LaserState,
): ResolvedJobPlacement {
  return resolveCameraSafeFramePlacement(app.project, app.jobPlacement, {
    statusReport: laser.statusReport,
    workOriginActive: laser.workOriginActive,
    wcoCache: laser.wcoCache,
    homingState: laser.homingState,
    trustedPositionEpoch: laser.trustedPositionEpoch ?? 0,
    reportInches: laser.controllerSettings?.reportInches === true,
  });
}
