import { resolveGrblDialect } from '../../../core/devices';
import { laserArcMovesEnabled } from '../../../core/devices/laser-arc-moves';
import { rotaryAppliesTo, type Job } from '../../../core/job';
import { laserSecondPassSupportsController } from '../../../core/laser-second-pass/source-family';
import { hasRepresentedCutBurn } from '../../../core/output/grbl-strategy';
import {
  powerScaleVersionForDevice,
  type LaserPowerScaleVersion,
} from '../../../core/output/laser-power-scale-version';
import { machineKindOf, type Project } from '../../../core/scene';

/** The same source contract governs offers, retained copies and the worker.
 * Inspect compiled output scope: unused Focus operations do not introduce Z. */
export function secondPassProjectEligible(
  project: Project,
  job: Job,
  laserPowerScaleVersion: LaserPowerScaleVersion = 2,
): boolean {
  if (
    machineKindOf(project.machine) !== 'laser' ||
    rotaryAppliesTo(project.device, project.machine) ||
    !laserSecondPassSupportsController(project.device.controllerKind)
  )
    return false;
  const context = {
    device: project.device,
    dialect: resolveGrblDialect(project.device),
    arcMovesEnabled: laserArcMovesEnabled(project.device),
    laserPowerScaleVersion: powerScaleVersionForDevice(project.device, laserPowerScaleVersion),
  };
  // The flat-only source parser cannot repaint Z motion. Zero offsets and
  // precision-collapsed samples emit no Z; retain their ordinary XY workflow.
  return !job.groups.some(
    (group) =>
      group.kind === 'cut' &&
      group.focusTest !== undefined &&
      group.focusTest.offsetMm !== 0 &&
      hasRepresentedCutBurn(group, context),
  );
}
