import { resolveGrblDialect } from '../../../core/devices';
import { laserArcMovesEnabled } from '../../../core/devices/laser-arc-moves';
import { hasRepresentedCutBurn } from '../../../core/output/grbl-strategy';
import {
  powerScaleVersionForDevice,
  type LaserPowerScaleVersion,
} from '../../../core/output/laser-power-scale-version';
import type { Job } from '../../../core/job';
import { focusTestWarnings } from '../../../core/job/focus-test';
import type { Project } from '../../../core/scene';

/** Only emitted Focus samples describe this review. The retained project may
 * still contain unused operations, unselected artwork and disabled subpasses. */
export function compiledFocusTestWarnings(prepared: {
  job: Job;
  project: Project;
  laserPowerScaleVersion?: LaserPowerScaleVersion;
}): string[] {
  const device = prepared.project.device;
  const context = {
    device,
    dialect: resolveGrblDialect(device),
    arcMovesEnabled: laserArcMovesEnabled(device),
    laserPowerScaleVersion: powerScaleVersionForDevice(
      device,
      prepared.laserPowerScaleVersion ?? 1,
    ),
  };
  return focusTestWarnings(
    prepared.job.groups.flatMap((group) =>
      group.kind === 'cut' && group.focusTest !== undefined && hasRepresentedCutBurn(group, context)
        ? [{ output: true, focusTest: group.focusTest }]
        : [],
    ),
    prepared.project.device,
  );
}
