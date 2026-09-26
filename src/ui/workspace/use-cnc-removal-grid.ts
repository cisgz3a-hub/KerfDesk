// Cancellable background removal-grid preparation for the CNC preview. Grid
// stamping can take seconds after toolpath preparation, so no render/effect in
// the browser realm calls computeCncRemovalGrid directly.

import { useEffect, useState } from 'react';
import type { CncMachineConfig, Project } from '../../core/scene';
import type { Vec2 } from '../../core/scene';
import type { RemovalGrid } from '../../core/sim';
import type { PreviewToolpath } from './preview-status';
import { previewJobOriginOffset } from './preview-scene-frame';
import {
  isCncRemovalGridSuperseded,
  prepareCncRemovalGridOffThread,
} from './cnc-removal-grid-worker-client';

const SCRUB_BUCKETS = 120;

type RemovalGridState = {
  readonly device: Project['device'];
  readonly machine: CncMachineConfig;
  readonly toolpath: PreviewToolpath;
  readonly scrubFraction: number;
  readonly jobOriginOffset: Vec2;
  readonly grid: RemovalGrid | null;
};

export function useCncRemovalGrid(
  project: Project,
  previewMode: boolean,
  toolpath: PreviewToolpath | null,
  scrubberT: number,
): RemovalGrid | null {
  return useCncRemovalGridState(project, previewMode, toolpath, scrubberT).grid;
}

export type CncRemovalGridState = {
  readonly grid: RemovalGrid | null;
  /** A newer grid is being prepared; null grid then means "not yet", not "none". */
  readonly pending: boolean;
};

export function useCncRemovalGridState(
  project: Project,
  previewMode: boolean,
  toolpath: PreviewToolpath | null,
  scrubberT: number,
): CncRemovalGridState {
  const machine = project.machine;
  const cncMachine = machine?.kind === 'cnc' ? machine : null;
  const device = project.device;
  const quantT = Math.ceil(Math.max(0, Math.min(1, scrubberT)) * SCRUB_BUCKETS) / SCRUB_BUCKETS;
  const { x: jobOriginOffsetX, y: jobOriginOffsetY } = removalGridPlacement(toolpath);
  const [state, setState] = useState<RemovalGridState | null>(null);

  useEffect(() => {
    if (!previewMode || cncMachine === null || toolpath === null || toolpath.totalLength <= 0) {
      setState(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const jobOriginOffset = { x: jobOriginOffsetX, y: jobOriginOffsetY };
    // Keyed even when empty, so a failed or unavailable grid reads as settled.
    const settle = (grid: RemovalGrid | null): void =>
      setState({
        device,
        machine: cncMachine,
        toolpath,
        scrubFraction: quantT,
        jobOriginOffset,
        grid,
      });
    const pending = prepareCncRemovalGridOffThread(
      {
        device,
        machine: cncMachine,
        toolpath,
        scrubFraction: quantT,
        jobOriginOffset,
      },
      controller.signal,
    );
    if (pending === null) {
      settle(null);
      return;
    }
    void pending.then(
      (grid) => {
        if (!cancelled) settle(grid);
      },
      (error: unknown) => {
        if (cancelled || isCncRemovalGridSuperseded(error)) return;
        settle(null);
      },
    );
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [previewMode, cncMachine, device, toolpath, quantT, jobOriginOffsetX, jobOriginOffsetY]);

  const eligible =
    previewMode && cncMachine !== null && toolpath !== null && toolpath.totalLength > 0;
  if (
    !matchesRemovalGridState(
      state,
      device,
      cncMachine,
      toolpath,
      quantT,
      jobOriginOffsetX,
      jobOriginOffsetY,
    )
  ) {
    return { grid: null, pending: eligible };
  }
  return { grid: state.grid, pending: false };
}

function removalGridPlacement(toolpath: PreviewToolpath | null): Vec2 {
  return toolpath === null ? { x: 0, y: 0 } : previewJobOriginOffset(toolpath);
}

function matchesRemovalGridState(
  state: RemovalGridState | null,
  device: Project['device'],
  machine: CncMachineConfig | null,
  toolpath: PreviewToolpath | null,
  scrubFraction: number,
  jobOriginOffsetX: number,
  jobOriginOffsetY: number,
): state is RemovalGridState {
  return (
    state !== null &&
    state.device === device &&
    state.machine === machine &&
    state.toolpath === toolpath &&
    state.scrubFraction === scrubFraction &&
    state.jobOriginOffset.x === jobOriginOffsetX &&
    state.jobOriginOffset.y === jobOriginOffsetY
  );
}
