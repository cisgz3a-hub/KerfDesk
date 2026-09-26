import { deviceForActiveHead } from '../../core/cnc/cnc-head-feeds';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import type { RecoveryCapsule } from '../state/recovery';
import type { RecoveryWorkBounds } from './laser-recovery-picker-model';
import { prepareTransientFrameController } from './use-frame-action';

/** Trace what a recovery would still engrave, from the controller's current
 * origin, through the ordinary Frame boundary (controller queue, work
 * coordinate system, setup checks). No run candidate is passed, so it never
 * issues a Start permit and gates nothing (ADR-341 Amendment 3). */
export async function frameRemainingRecoveryArea(
  capsule: RecoveryCapsule,
  bounds: RecoveryWorkBounds,
): Promise<void> {
  if (capsule.artifact.kind !== 'exact-execution') return;
  const project = capsule.artifact.prepared.project;
  try {
    const controller = await prepareTransientFrameController(project);
    if (controller === null) return;
    const { framingFeedMmPerMin } = deviceForActiveHead(project.device, project.machine);
    await controller.laser.frame(bounds, framingFeedMmPerMin, undefined, project);
  } catch (error) {
    jobAwareAlert(
      `Cannot frame the remaining area:\n\n${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
