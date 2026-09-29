// CNC Z-travel advisory (second CNC audit P2-gcode-1 and JR-3). A job's Z range
// runs from its deepest cut up to the highest lift it commands: every group's
// safe Z and, since ADR-491, the park height the bit lifts to before the
// job-end park and each bit change. When that range is longer than the Z axis,
// no work zero fits the job: the lift or the cut drives Z into a stop. GRBL's
// soft limits are off by default, so the motor stalls there and loses steps,
// and every later cut runs deeper. Advisory only, never a Start block
// (PROJECT.md rule 21, ADR-228).

import { cncGroupMaximumDepthMm } from '../../core/cnc/output-representation';
import type { ControllerSettingsSnapshot } from '../../core/controllers/grbl';
import type { CncGroup, Job } from '../../core/job';
import { parkHeightMm } from '../../core/output/cnc-grbl-transitions';
import type { Project } from '../../core/scene';
import { formatMm } from './job-review/job-review-format';

export function detectCncZTravelWarnings(
  project: Project,
  controllerSettings: ControllerSettingsSnapshot | null,
  job: Job | undefined,
): ReadonlyArray<string> {
  if (project.machine?.kind !== 'cnc' || job === undefined) return [];
  const live = controllerSettings?.zTravelMm;
  const travel = live ?? project.device.zTravelMm;
  if (travel === undefined || !(travel > 0)) return [];
  const groups = job.groups.filter((group): group is CncGroup => group.kind === 'cnc');
  if (groups.length === 0) return [];
  const deepestMm = Math.max(...groups.map(cncGroupMaximumDepthMm));
  const safeZMm = Math.max(...groups.map((group) => group.safeZMm));
  const liftMm = Math.max(...groups.map((group) => parkHeightMm(group, safeZMm)));
  const spanMm = liftMm + deepestMm;
  if (!(spanMm > travel)) return [];
  const lift = liftMm > safeZMm ? 'park height' : 'safe Z';
  const source =
    live === undefined ? 'the machine profile records' : 'the controller reports ($132)';
  return [
    `This job needs ${formatMm(spanMm)} mm of Z, from its deepest cut at Z-${formatMm(deepestMm)} ` +
      `up to the ${lift} lift at Z${formatMm(liftMm)}, but ${source} ${formatMm(travel)} mm of ` +
      'Z travel. No work zero fits both: Z runs into a stop, where it can stall and lose ' +
      `steps so later cuts run deeper. Lower the ${lift} or cut less deep.`,
  ];
}
