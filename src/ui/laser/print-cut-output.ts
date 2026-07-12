import type { SimilarityTransform } from '../../core/registration';
import type { Project } from '../../core/scene';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { useLaserStore } from '../state/laser-store';
import {
  resolvePrintCutRegistration,
  usePrintCutSessionStore,
} from '../state/print-cut-session-store';

export function currentPrintCutOutputRegistration(
  project: Project,
): SimilarityTransform | null | undefined {
  if (project.printAndCutTargets === undefined) return undefined;
  if (!useExperimentalLaserFeatures.getState().features.printAndCut) return null;
  if (!project.device.homing.enabled) return null;
  const laser = useLaserStore.getState();
  const resolved = resolvePrintCutRegistration(
    project,
    laser.trustedPositionEpoch ?? 0,
    usePrintCutSessionStore.getState(),
  );
  return resolved.kind === 'valid' ? resolved.transform : null;
}
