import { compileJob, islandFillMotionPolicyForDevice, isSensitiveIslandFillPolicy } from '../job';
import type { Project } from '../scene';

export const MACHINE_ISLAND_FILL_RISK_CODE = 'machine-island-fill-risk';

export type MachineProfilePreflightIssue = {
  readonly code: typeof MACHINE_ISLAND_FILL_RISK_CODE;
  readonly message: string;
};

const NEOTRONICS_4040_ISLAND_FILL_RISK_MESSAGE =
  'Neotronics 4040-safe Island Fill needs fill overscan greater than 0 mm so the head has laser-off acceleration runway. Set Fill overscan to 5 mm or use Scanline Fill.';

export function findMachineProfilePreflightIssues(
  project: Project,
): ReadonlyArray<MachineProfilePreflightIssue> {
  if (islandFillMotionPolicyForDevice(project.device) !== 'sensitive') return [];
  const job = compileJob(project.scene, project.device);
  const hasSensitiveIslandFillWithoutOverscan = job.groups.some(
    (group) =>
      group.kind === 'fill' &&
      group.fillStyle === 'island' &&
      isSensitiveIslandFillPolicy(group.islandMotionPolicy) &&
      group.overscanMm <= 0,
  );
  if (!hasSensitiveIslandFillWithoutOverscan) return [];
  return [
    {
      code: MACHINE_ISLAND_FILL_RISK_CODE,
      message: NEOTRONICS_4040_ISLAND_FILL_RISK_MESSAGE,
    },
  ];
}
