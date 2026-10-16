import { rotaryAppliesTo, type Job } from '../../../core/job';
import { resolveGrblDialect } from '../../../core/devices';
import { laserArcMovesEnabled } from '../../../core/devices/laser-arc-moves';
import { hasRepresentedCutBurn } from '../../../core/output/grbl-strategy';
import { powerScaleVersionForDevice } from '../../../core/output/laser-power-scale-version';
import { laserSecondPassSupportsController } from '../../../core/laser-second-pass/source-family';
import { machineKindOf, type Project } from '../../../core/scene';

/** The same source contract governs offers, retained copies and the worker. */
export function secondPassProjectEligible(project: Project, job: Job): boolean {
  const device = project.device;
  const context = {
    device,
    dialect: resolveGrblDialect(device),
    arcMovesEnabled: laserArcMovesEnabled(device),
    laserPowerScaleVersion: powerScaleVersionForDevice(device),
  };
  return (
    machineKindOf(project.machine) === 'laser' &&
    !rotaryAppliesTo(project.device, project.machine) &&
    laserSecondPassSupportsController(project.device.controllerKind) &&
    // The painter preserves XY motion only. Use compiled samples: retained
    // unused Focus layers do not move Z, and zero-offset samples emit only XY.
    !job.groups.some(
      (group) =>
        group.kind === 'cut' &&
        group.focusTest !== undefined &&
        group.focusTest.offsetMm !== 0 &&
        hasRepresentedCutBurn(group, context),
    )
  );
}
