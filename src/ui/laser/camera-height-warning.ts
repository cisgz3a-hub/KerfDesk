// Job Review's word on the height the camera picture is drawn at (ADR-441
// Amendment 13, camera audit v2 K2-P1-2, K2-P2-1 and K1-P2-2): on a rotary,
// against the job's material, and for a calibration that lines up only at its
// target's height. Said, never refused (ADR-228).

import type { CameraModelRecord } from '../../core/camera/model/camera-model-record';
import type { JobOriginPlacement } from '../../core/job';
import type { Project } from '../../core/scene';
import {
  cameraHeightFacts,
  cameraHeightIssues,
  cameraHeightJobWarning,
} from '../camera/camera-height-rule';

export function cameraHeightWarnings(
  project: Pick<Project, 'device' | 'machine' | 'jobSetup'>,
  machine: {
    readonly cameraPlacementActive?: boolean;
    readonly cameraCalibration?: CameraModelRecord | null;
    readonly cameraSurfaceHeightMm?: number;
  },
  jobOrigin: JobOriginPlacement | undefined,
): string[] {
  const height = machine.cameraSurfaceHeightMm;
  if (machine.cameraPlacementActive !== true || height === undefined) return [];
  const facts = cameraHeightFacts(project, height, machine.cameraCalibration);
  // Placed by a relative Start from, a flat job burns where that origin puts
  // it, which Job Review says already; a rotary job is placed on the picture
  // either way (ADR-228 Amendment 3).
  const absolute = jobOrigin === undefined || jobOrigin.startFrom === 'absolute';
  return cameraHeightIssues(facts)
    .filter((issue) => issue.kind === 'rotary' || absolute)
    .map(cameraHeightJobWarning);
}
