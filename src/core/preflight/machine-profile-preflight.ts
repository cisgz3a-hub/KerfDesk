import { analyzeFillHeatRisk, compileJob } from '../job';
import type { Project } from '../scene';

export type MachineProfilePreflightIssue = {
  readonly code: 'machine-island-fill-risk';
  readonly message: string;
};

const NEOTRONICS_4040_ISLAND_FILL_RISK_MESSAGE =
  'Neotronics 4040 Island Fill has short acceleration-sensitive sweeps. Use Scanline Fill for this burn; Island Fill on this profile needs dedicated material/motion calibration before it should be trusted.';

const NEOTRONICS_4040_MIN_SAFE_ISLAND_SWEEP_MM = 10;

export function findMachineProfilePreflightIssues(
  project: Project,
): ReadonlyArray<MachineProfilePreflightIssue> {
  if (!isNeotronics4040(project)) return [];
  const heat = analyzeFillHeatRisk(compileJob(project.scene, project.device));
  const riskyIslandSweeps = heat.islandNoRunwayShortSweepCount + heat.islandPartialRunwaySweepCount;
  const hasShortIslandSweep =
    heat.minIslandSweepMm !== null &&
    heat.minIslandSweepMm < NEOTRONICS_4040_MIN_SAFE_ISLAND_SWEEP_MM;
  if (riskyIslandSweeps === 0 && !hasShortIslandSweep) return [];
  return [
    {
      code: 'machine-island-fill-risk',
      message: NEOTRONICS_4040_ISLAND_FILL_RISK_MESSAGE,
    },
  ];
}

function isNeotronics4040(project: Project): boolean {
  return (
    project.device.machineFamily === 'neotronics-4040-max' ||
    project.device.profileId === 'neotronics-4040-max-lt4lds-v2-20w'
  );
}
