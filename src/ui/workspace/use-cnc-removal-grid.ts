// Cancellable background removal-grid preparation for the CNC preview. Grid
// stamping can take seconds after toolpath preparation, so no render/effect in
// the browser realm calls computeCncRemovalGrid directly.

import { useEffect, useMemo, useState } from 'react';
import type { CncMachineConfig, Project } from '../../core/scene';
import type { Vec2 } from '../../core/scene';
import type { RemovalGrid } from '../../core/sim';
import type { PreviewToolpath } from './preview-status';
import { previewJobOriginOffset } from './preview-scene-frame';
import { createCoalescedJob } from './coalesced-preview-job';
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

  // One job per preview session. A scrubber step asks it for a newer fraction
  // without cancelling the grid it is preparing (ADR-425): on a slow machine
  // playback outruns the worker, and cancelling meant no grid ever arrived.
  const job = useMemo(() => {
    if (!previewMode || cncMachine === null || toolpath === null || toolpath.totalLength <= 0) {
      return null;
    }
    const jobOriginOffset = { x: jobOriginOffsetX, y: jobOriginOffsetY };
    return createCoalescedJob<number, RemovalGrid | null>(
      (scrubFraction, signal) =>
        prepareCncRemovalGridOffThread(
          { device, machine: cncMachine, toolpath, scrubFraction, jobOriginOffset },
          signal,
        ),
      // Keyed even when empty, so a failed or unavailable grid reads as settled.
      (scrubFraction, outcome) =>
        setState({
          device,
          machine: cncMachine,
          toolpath,
          scrubFraction,
          jobOriginOffset,
          grid: outcome.kind === 'done' ? outcome.value : null,
        }),
      isCncRemovalGridSuperseded,
    );
  }, [previewMode, cncMachine, device, toolpath, jobOriginOffsetX, jobOriginOffsetY]);

  useEffect(() => {
    if (job === null) {
      setState(null);
      return;
    }
    return () => job.cancel();
  }, [job]);
  useEffect(() => {
    job?.request(quantT);
  }, [job, quantT]);

  const eligible = job !== null;
  if (
    !matchesRemovalGridSession(
      state,
      device,
      cncMachine,
      toolpath,
      jobOriginOffsetX,
      jobOriginOffsetY,
    )
  ) {
    return { grid: null, pending: eligible };
  }
  // An earlier fraction's grid stays up while the newest one is prepared.
  return { grid: state.grid, pending: state.scrubFraction !== quantT };
}

function removalGridPlacement(toolpath: PreviewToolpath | null): Vec2 {
  return toolpath === null ? { x: 0, y: 0 } : previewJobOriginOffset(toolpath);
}

function matchesRemovalGridSession(
  state: RemovalGridState | null,
  device: Project['device'],
  machine: CncMachineConfig | null,
  toolpath: PreviewToolpath | null,
  jobOriginOffsetX: number,
  jobOriginOffsetY: number,
): state is RemovalGridState {
  return (
    state !== null &&
    state.device === device &&
    state.machine === machine &&
    state.toolpath === toolpath &&
    state.jobOriginOffset.x === jobOriginOffsetX &&
    state.jobOriginOffset.y === jobOriginOffsetY
  );
}
