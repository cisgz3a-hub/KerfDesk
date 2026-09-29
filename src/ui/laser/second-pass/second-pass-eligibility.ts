import { rotaryAppliesTo } from '../../../core/job';
import { laserSecondPassSupportsController } from '../../../core/laser-second-pass/source-family';
import { machineKindOf, type Project } from '../../../core/scene';

/** The same source contract governs offers, retained copies and the worker. */
export function secondPassProjectEligible(project: Project): boolean {
  return (
    machineKindOf(project.machine) === 'laser' &&
    !rotaryAppliesTo(project.device, project.machine) &&
    laserSecondPassSupportsController(project.device.controllerKind)
  );
}
