// detectMachineJobWarnings — selects the machine-appropriate advisory set for
// the Save G-code and Start job paths: CNC projects get stock-footprint
// advisories (H.2); laser projects get the job-intent warnings (H12). Keeps
// the machine-kind branch in ONE place so both call sites stay simple.

import type { Project } from '../../core/scene';
import { detectCncStockWarnings } from './cnc-stock-warnings';
import { detectJobIntentWarnings } from './job-intent-warnings';

export function detectMachineJobWarnings(project: Project): ReadonlyArray<string> {
  return project.machine?.kind === 'cnc'
    ? detectCncStockWarnings(project)
    : detectJobIntentWarnings(project);
}
