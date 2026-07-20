// useJobEstimate — debounced live ETA for the current scene + device.
//
// H16 (AUDIT-2026-06-10): the estimate used to recompute synchronously per
// project identity, and setObjectTransform replaces the project on EVERY
// pointer-move — so dragging an object re-ran compile (including the raster
// base64-decode + resample + dither pipeline, bounded only by the 4M px
// budget) once per mousemove on the main thread. A trailing debounce keeps
// the badge fresh ~a quarter second after the user stops moving, while a
// drag costs zero recompiles.

import { useEffect, useMemo, useState } from 'react';
import type { JobOriginPlacement } from '../../core/job';
import type { Project } from '../../core/scene';
import { currentOutputScope, useStore } from '../state';
import {
  estimateLiveJob,
  estimateLiveJobSnapshot,
  type LiveJobEstimate,
} from './live-job-estimate';
import { renderVariableText } from '../text/render-variable-text';
import { currentPrintCutOutputRegistration } from './print-cut-output';
import { useLaserStore } from '../state/laser-store';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { resolveJobPlacement } from '../job-placement';

export const JOB_ESTIMATE_DEBOUNCE_MS = 250;

type Settled = {
  readonly project: Project | null;
  readonly outputScopeKey: string;
  readonly registrationKey: string;
  readonly placementKey: string;
  readonly estimate: LiveJobEstimate;
};

export function useJobEstimate(): LiveJobEstimate {
  const project = useStore((s) => s.project);
  const outputScope = useStore((s) => currentOutputScope(s));
  const jobPlacement = useStore((s) => s.jobPlacement);
  const outputScopeKey = JSON.stringify(outputScope);
  const positionEpoch = useLaserStore((state) => state.trustedPositionEpoch ?? 0);
  const firstRegistrationPoint = usePrintCutSessionStore((state) => state.first);
  const secondRegistrationPoint = usePrintCutSessionStore((state) => state.second);
  const resolvedPlacement = useEstimatePlacement(jobPlacement);
  const placementKey = JSON.stringify(resolvedPlacement);
  const jobOrigin = resolvedPlacement.ok ? resolvedPlacement.jobOrigin : undefined;
  const registrationKey = JSON.stringify({
    positionEpoch,
    firstRegistrationPoint,
    secondRegistrationPoint,
  });
  const initialRegistration = currentPrintCutOutputRegistration(project);
  const initiallyAsync = hasVariableText(project) || initialRegistration !== undefined;
  return useSettledEstimate({
    project,
    outputScope,
    outputScopeKey,
    registrationKey,
    placementKey,
    jobOrigin,
    initiallyAsync,
  });
}

function useEstimatePlacement(jobPlacement: ReturnType<typeof useStore.getState>['jobPlacement']) {
  const statusReport = useLaserStore((state) => state.statusReport);
  const workOriginActive = useLaserStore((state) => state.workOriginActive);
  const wcoCache = useLaserStore((state) => state.wcoCache);
  const reportInches = useLaserStore((state) => state.controllerSettings?.reportInches === true);
  return useMemo(
    () =>
      resolveJobPlacement(jobPlacement, {
        statusReport,
        workOriginActive,
        wcoCache,
        reportInches,
      }),
    [jobPlacement, statusReport, workOriginActive, wcoCache, reportInches],
  );
}

function useSettledEstimate(args: {
  readonly project: Project;
  readonly outputScope: ReturnType<typeof currentOutputScope>;
  readonly outputScopeKey: string;
  readonly registrationKey: string;
  readonly placementKey: string;
  readonly jobOrigin: JobOriginPlacement | undefined;
  readonly initiallyAsync: boolean;
}): LiveJobEstimate {
  const {
    project,
    outputScope,
    outputScopeKey,
    registrationKey,
    placementKey,
    jobOrigin,
    initiallyAsync,
  } = args;
  // Compute the first badge synchronously, then debounce later mutations.
  const [settled, setSettled] = useState<Settled>(() => ({
    project: initiallyAsync ? null : project,
    outputScopeKey,
    registrationKey,
    placementKey,
    estimate: estimateLiveJob(project, outputScope, jobOrigin),
  }));
  useEffect(() => {
    if (
      settled.project === project &&
      settled.outputScopeKey === outputScopeKey &&
      settled.registrationKey === registrationKey &&
      settled.placementKey === placementKey
    ) {
      return undefined;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      const registration = currentPrintCutOutputRegistration(project);
      const estimate =
        hasVariableText(project) || registration !== undefined
          ? estimateLiveJobSnapshot(
              project,
              outputScope,
              () => new Date(),
              renderVariableText,
              registration,
              jobOrigin,
            )
          : Promise.resolve(estimateLiveJob(project, outputScope, jobOrigin));
      void estimate.then((value) => {
        if (!cancelled) {
          setSettled({ project, outputScopeKey, registrationKey, placementKey, estimate: value });
        }
      });
    }, JOB_ESTIMATE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [
    project,
    outputScope,
    outputScopeKey,
    settled.project,
    settled.outputScopeKey,
    settled.registrationKey,
    settled.placementKey,
    registrationKey,
    placementKey,
    jobOrigin,
  ]);
  return settled.estimate;
}

function hasVariableText(project: Project): boolean {
  return project.scene.objects.some(
    (object) => object.kind === 'text' && object.variableTemplate !== undefined,
  );
}
