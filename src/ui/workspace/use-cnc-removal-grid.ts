// Cancellable background removal-grid preparation for the CNC preview. Grid
// stamping can take seconds after toolpath preparation, so no render/effect in
// the browser realm calls computeCncRemovalGrid directly.

import { useEffect, useState } from 'react';
import type { Toolpath } from '../../core/job';
import type { CncMachineConfig, Project } from '../../core/scene';
import type { RemovalGrid } from '../../core/sim';
import {
  isCncRemovalGridSuperseded,
  prepareCncRemovalGridOffThread,
} from './cnc-removal-grid-worker-client';

const SCRUB_BUCKETS = 120;

type RemovalGridState = {
  readonly device: Project['device'];
  readonly machine: CncMachineConfig;
  readonly toolpath: Toolpath;
  readonly scrubFraction: number;
  readonly grid: RemovalGrid | null;
};

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
  const [state, setState] = useState<RemovalGridState | null>(null);

  useEffect(() => {
    if (!previewMode || cncMachine === null || toolpath === null || toolpath.totalLength <= 0) {
      setState(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const pending = prepareCncRemovalGridOffThread(
      {
        device,
        machine: cncMachine,
        toolpath,
        scrubFraction: quantT,
      },
      controller.signal,
    );
    if (pending === null) {
      setState(null);
      return;
    }
    void pending.then(
      (grid) => {
        if (cancelled) return;
        setState({ device, machine: cncMachine, toolpath, scrubFraction: quantT, grid });
      },
      (error: unknown) => {
        if (cancelled || isCncRemovalGridSuperseded(error)) return;
        setState(null);
      },
    );
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [previewMode, cncMachine, device, toolpath, quantT]);

  if (
    state === null ||
    state.device !== device ||
    state.machine !== cncMachine ||
    state.toolpath !== toolpath ||
    state.scrubFraction !== quantT
  ) {
    return null;
  }
  return state.grid;
}
