// The CNC half of Job Review's machine facts (ADR-224): stock, bit, powered Z,
// safe Z, spindle, coolant and the park rows. Split from job-review-live-rows
// when that file reached the ADR-015 size cap.

import type { JobOriginPlacement } from '../../../core/job';
import { activeCncTool, type CncMachineConfig, type Project } from '../../../core/scene';
import type { CncLiftZTopCheck } from '../cnc-park-z-top';
import { formatMm } from './job-review-format';
import { parkFacts, type ParkFact } from './job-review-park-label';

export function cncMachineReviewFacts(
  project: Project,
  machine: CncMachineConfig,
  startFrom: JobOriginPlacement['startFrom'] | undefined,
  zTop: CncLiftZTopCheck | undefined,
): ReadonlyArray<ParkFact> {
  const { params, stock } = machine;
  return [
    fact(
      'Stock',
      `${formatMm(stock.widthMm)} × ${formatMm(stock.heightMm)} × ${formatMm(stock.thicknessMm)} mm`,
    ),
    fact('Active bit', activeCncTool(machine).name),
    poweredZAssumptionFact(project),
    fact('Safe Z', `${formatMm(params.safeZMm)} mm above stock top`),
    fact('Spindle', `max ${params.spindleMaxRpm} RPM · spin-up ${params.spindleSpinupSec} s`),
    fact('Coolant', params.coolant ?? 'off'),
    ...parkFacts(params, startFrom, project.device.zTravelMm, zTop),
  ];
}

function poweredZAssumptionFact(project: Project): ParkFact {
  const travel = project.device.zTravelMm;
  const recorded = travel === undefined ? 'no travel recorded' : `${formatMm(travel)} mm recorded`;
  return fact(
    'Powered Z assumption',
    `CNC assumes installed powered Z · ${recorded} (informational, not hardware proof)`,
    'warning',
  );
}

function fact(label: string, value: string, tone: ParkFact['tone'] = 'default'): ParkFact {
  return { label, value, tone };
}
