// Collect a Job's CNC groups paired with their Job.groups indices. Pass spans
// and recovery slicing speak the job's own indices (ADR-215), so the emitter
// must not renumber groups when non-CNC groups are dropped.

import type { CncGroup, Job } from '../job';
import { assertNever } from '../scene';

export type IndexedCncGroup = {
  readonly group: CncGroup;
  readonly jobGroupIndex: number;
};

export function collectIndexedCncGroups(job: Job): ReadonlyArray<IndexedCncGroup> {
  const cncGroups: IndexedCncGroup[] = [];
  for (const [jobGroupIndex, group] of job.groups.entries()) {
    switch (group.kind) {
      case 'cnc':
        cncGroups.push({ group, jobGroupIndex });
        break;
      case 'cut':
      case 'fill':
      case 'raster':
        // Laser groups never belong in a CNC job; emit-gcode routes them to
        // grblStrategy. Reaching here means a pipeline bug — drop loudly.
        break;
      default:
        assertNever(group, 'Group');
    }
  }
  return cncGroups;
}
