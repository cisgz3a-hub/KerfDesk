// useJobEstimate — debounced live ETA for the current scene + device.
//
// H16 (AUDIT-2026-06-10): the estimate used to recompute synchronously per
// project identity, and setObjectTransform replaces the project on EVERY
// pointer-move — so dragging an object re-ran compile (including the raster
// base64-decode + resample + dither pipeline, bounded only by the 4M px
// budget) once per mousemove on the main thread. A trailing debounce keeps
// the badge fresh ~a quarter second after the user stops moving, while a
// drag costs zero recompiles.

import { useEffect, useState } from 'react';
import type { Project } from '../../core/scene';
import { currentOutputScope, useStore } from '../state';
import { estimateLiveJob, type LiveJobEstimate } from './live-job-estimate';

export const JOB_ESTIMATE_DEBOUNCE_MS = 250;

type Settled = {
  readonly project: Project;
  readonly outputScopeKey: string;
  readonly estimate: LiveJobEstimate;
};

export function useJobEstimate(): LiveJobEstimate {
  const project = useStore((s) => s.project);
  const outputScope = useStore((s) => currentOutputScope(s));
  const outputScopeKey = JSON.stringify(outputScope);
  // First render computes synchronously so the badge is present on load;
  // later project mutations re-estimate only after a quiet period.
  const [settled, setSettled] = useState<Settled>(() => ({
    project,
    outputScopeKey,
    estimate: estimateLiveJob(project, outputScope),
  }));
  useEffect(() => {
    if (settled.project === project && settled.outputScopeKey === outputScopeKey) return undefined;
    const handle = setTimeout(() => {
      setSettled({
        project,
        outputScopeKey,
        estimate: estimateLiveJob(project, outputScope),
      });
    }, JOB_ESTIMATE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [project, outputScope, outputScopeKey, settled.project, settled.outputScopeKey]);
  return settled.estimate;
}
