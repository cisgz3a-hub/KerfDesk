// detectMachineJobWarnings — selects the machine-appropriate advisory set for
// the Save G-code and Start job paths: CNC projects get stock-footprint
// advisories (H.2) plus dropped-raster advisories (ADR-101 §4); laser
// projects get the job-intent warnings (H12). Keeps the machine-kind branch
// in ONE place so both call sites stay simple.

import type { ControllerSettingsSnapshot } from '../../core/controllers/grbl';
import type { Project } from '../../core/scene';
import { detectCncDefaultFeedWarnings } from './cnc-default-feed-warnings';
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
): ReadonlyArray<string> {
  return project.machine?.kind === 'cnc'
    ? [
        ...detectCncStockWarnings(project),
        ...detectCncThroughCutTabWarnings(project),
        ...detectCncDefaultFeedWarnings(project),
        ...detectCncMachineLimitWarnings(project, controllerSettings),
        ...detectCncRasterWarnings(project),
      ]
    : [
        ...detectJobIntentWarnings(project),
        ...detectLaserMachineLimitWarnings(project, controllerSettings),
      ];
}
