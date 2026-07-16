// detectMachineJobWarnings — selects the machine-appropriate advisory set for
// the Save G-code and Start job paths: CNC projects get stock-footprint
// advisories (H.2) plus dropped-raster advisories (ADR-101 §4); laser
// projects get the job-intent warnings (H12). Keeps the machine-kind branch
// in ONE place so both call sites stay simple.

import type { ControllerSettingsSnapshot } from '../../core/controllers/grbl';
import type { ActiveWorkCoordinateSystem } from '../../core/controllers/grbl/work-offset-readback';
import type { Project } from '../../core/scene';
import { detectActiveWcsMismatchWarnings } from './active-wcs-warnings';
import { detectCncDefaultFeedWarnings } from './cnc-default-feed-warnings';
import { detectCncFullTabCoverageWarnings } from './cnc-full-tab-coverage-warnings';
import { detectCncMachineLimitWarnings } from './cnc-machine-limit-warnings';
import { detectCncRasterWarnings } from './cnc-raster-warnings';
import { detectCncStockWarnings } from './cnc-stock-warnings';
import { detectCncThroughCutTabWarnings } from './cnc-through-cut-tab-warnings';
import { detectJobIntentWarnings } from './job-intent-warnings';
import { detectLaserMachineLimitWarnings } from './laser-machine-limit-warnings';

// controllerSettings is the connected machine's live `$$` snapshot (null when
// nothing is connected); it feeds the CNC limit advisories (stock vs travel,
// feed vs max rate) and defaults to null so callers without it are unchanged.
export function detectMachineJobWarnings(
  project: Project,
  controllerSettings: ControllerSettingsSnapshot | null = null,
  activeWcs: ActiveWorkCoordinateSystem | null = null,
): ReadonlyArray<string> {
  // Machine-agnostic: both laser and CNC pin G54 in emission, so a non-G54
  // active WCS mismatches either job's placement (C6). Defaults to null so
  // callers that do not track it are unchanged (no warning).
  const machineWarnings =
    project.machine?.kind === 'cnc'
      ? [
          ...detectCncStockWarnings(project),
          ...detectCncThroughCutTabWarnings(project),
          ...detectCncFullTabCoverageWarnings(project),
          ...detectCncDefaultFeedWarnings(project),
          ...detectCncMachineLimitWarnings(project, controllerSettings),
          ...detectCncRasterWarnings(project),
        ]
      : [
          ...detectJobIntentWarnings(project),
          ...detectLaserMachineLimitWarnings(project, controllerSettings),
        ];
  return [...detectActiveWcsMismatchWarnings(activeWcs), ...machineWarnings];
}
