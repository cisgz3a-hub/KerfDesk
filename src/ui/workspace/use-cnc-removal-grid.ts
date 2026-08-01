// useCncRemovalGrid — memoizes the CNC preview's removal grid
// (computeCncRemovalGrid) across renders.
//
// The scrub position quantizes into buckets so dragging the slider reuses
// memoized grids instead of recomputing per pixel of mouse movement.

import { useMemo } from 'react';
import type { Toolpath } from '../../core/job';
import type { Project } from '../../core/scene';
import type { RemovalGrid } from '../../core/sim';
import { computeCncRemovalGrid } from './cnc-removal-grid';

const SCRUB_BUCKETS = 120;

export function useCncRemovalGrid(
  project: Project,
  previewMode: boolean,
  toolpath: Toolpath | null,
  scrubberT: number,
): RemovalGrid | null {
  const machine = project.machine;
  const cncMachine = machine?.kind === 'cnc' ? machine : null;
  const device = project.device;
  const quantT = Math.ceil(Math.max(0, Math.min(1, scrubberT)) * SCRUB_BUCKETS) / SCRUB_BUCKETS;

  return useMemo(() => {
    if (!previewMode || cncMachine === null || toolpath === null) return null;
    if (toolpath.totalLength <= 0) return null;
    return computeCncRemovalGrid(device, cncMachine, toolpath, quantT);
  }, [previewMode, cncMachine, device, toolpath, quantT]);
}
