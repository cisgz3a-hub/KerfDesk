// Job Review's word on artwork placed on the camera picture where the camera
// calibration is estimated, not measured (ADR-441 Amendment 9, rolling audit
// v13 Y1-P2-1). The rings pin the picture down only on the target; past it
// the fitted lens extrapolates, and on a part-bed sheet that was measured
// millimetres off. Said, never refused (ADR-228).

import {
  estimateWithin,
  extrapolationEstimate,
  GOOD_EXTRAPOLATED_MM,
} from '../../core/camera/model/extrapolation-estimate';
import type { CameraModelRecord } from '../../core/camera/model/camera-model-record';
import type { JobOriginPlacement } from '../../core/job';
import { computeJobBounds, type JobBounds } from '../../core/job/job-bounds';
import type { Job } from '../../core/job';
import type { Project } from '../../core/scene';

export function cameraOffTargetWarning(args: {
  readonly cameraPlacementActive: boolean | undefined;
  readonly model: CameraModelRecord | null | undefined;
  readonly jobOrigin: JobOriginPlacement | undefined;
  /** The job's bounds in design (bed) millimetres. */
  readonly jobBounds: JobBounds | null;
}): string | null {
  const { model, jobBounds } = args;
  if (args.cameraPlacementActive !== true || model == null || jobBounds === null) return null;
  // Placed by a relative Start from, the job burns where that origin puts it;
  // Job Review says so already (cameraPlacementStartFromWarning).
  if (args.jobOrigin !== undefined && args.jobOrigin.startFrom !== 'absolute') return null;
  const estimate = extrapolationEstimate(model);
  const mm = estimate === null ? null : estimateWithin(estimate, jobBounds);
  if (mm === null || mm <= GOOD_EXTRAPOLATED_MM) return null;
  return `Camera placement is on, and part of this job lies where the camera calibration is estimated rather than measured: there the camera picture may be up to about ${Math.round(mm * 10) / 10} mm off, so the job may burn that far from where it shows on the picture. Watch the Frame, or engrave the calibration target on a larger sheet that covers this part of the bed.`;
}

/** Start's form: the job's own bounds, from the snapshot's camera facts. */
export function cameraOffTargetWarnings(
  machine: {
    readonly cameraPlacementActive?: boolean;
    readonly cameraCalibration?: CameraModelRecord | null;
  },
  jobOrigin: JobOriginPlacement | undefined,
  prepared: { readonly job: Job; readonly project: Pick<Project, 'device'> },
): string[] {
  const warning = cameraOffTargetWarning({
    cameraPlacementActive: machine.cameraPlacementActive,
    model: machine.cameraCalibration,
    jobOrigin,
    jobBounds:
      machine.cameraPlacementActive === true
        ? computeJobBounds(prepared.job, prepared.project.device)
        : null,
  });
  return warning === null ? [] : [warning];
}
