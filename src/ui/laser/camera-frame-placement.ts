import type { Project } from '../../core/scene';
import {
  resolveJobPlacement,
  type JobPlacementSettings,
  type MachinePlacementSnapshot,
  type ResolvedJobPlacement,
} from '../job-placement';
import type { HomingState } from '../state/laser-store';

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
