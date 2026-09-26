import type { SimilarityTransform } from '../../core/registration';
import type { Project } from '../../core/scene';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { useLaserStore } from '../state/laser-store';
import { nativeBedCaptureFrameKey } from '../state/native-bed-frame';
import {
  resolvePrintCutRegistration,
  usePrintCutSessionStore,
} from '../state/print-cut-session-store';

// Print and Cut is a laser feature (hidden in CNC by ADR-101). Its targets stay
// saved on the project across a switch to CNC so the laser gets them back, but
// a router program never takes the laser head's two-point registration: the
// points were captured with the laser, and a spindle sits at another offset.
export function currentPrintCutOutputRegistration(
  project: Project,
): SimilarityTransform | null | undefined {
  if (project.printAndCutTargets === undefined) return undefined;
  if (project.machine?.kind === 'cnc') return undefined;
  if (!useExperimentalLaserFeatures.getState().features.printAndCut) return null;
  const laser = useLaserStore.getState();
  const resolved = resolvePrintCutRegistration(
    project,
    laser.trustedPositionEpoch ?? 0,
    usePrintCutSessionStore.getState(),
    nativeBedCaptureFrameKey(project.device, laser),
  );
  return resolved.kind === 'valid' ? resolved.transform : null;
}
