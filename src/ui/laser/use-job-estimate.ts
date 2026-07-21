// useJobEstimate — debounced live ETA for the current scene + device.
//
// H16 (AUDIT-2026-06-10): the estimate used to recompute synchronously per
// project identity, and setObjectTransform replaces the project on EVERY
// pointer-move — so dragging an object re-ran compile (including the raster
// base64-decode + resample + dither pipeline, bounded only by the 4M px
// budget) once per mousemove on the main thread. A trailing debounce keeps
// the badge fresh ~a quarter second after the user stops moving, while a
// drag costs zero recompiles.

import { useEffect, useMemo, useRef, useState } from 'react';
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
import { prepareLargeJobOffThread } from '../workspace/preparation-worker-client';

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

function useSettledEstimate({
  project,
  outputScope,
  outputScopeKey,
  registrationKey,
  placementKey,
  jobOrigin,
  initiallyAsync,
}: {
  readonly project: Project;
  readonly outputScope: ReturnType<typeof currentOutputScope>;
  readonly outputScopeKey: string;
  readonly registrationKey: string;
  readonly placementKey: string;
  readonly jobOrigin: JobOriginPlacement | undefined;
  readonly initiallyAsync: boolean;
}): LiveJobEstimate {
  // Compute the first badge synchronously, then debounce later mutations.
  const [settled, setSettled] = useState<Settled>(() => ({
    project: initiallyAsync ? null : project,
    outputScopeKey,
    registrationKey,
    placementKey,
    estimate: estimateLiveJob(project, outputScope, jobOrigin),
  }));
  // The ADR-244 worker follow-up must survive the settle-triggered effect
  // cleanup (settling changes the deps and re-runs the effect), so it is
  // cancelled by GENERATION — a newer recompute or unmount — not by the
  // effect's own cancelled flag.
  const workerGeneration = useRef(0);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
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
      workerGeneration.current += 1;
      const generation = workerGeneration.current;
      const settleAt = (value: LiveJobEstimate): void =>
        setSettled({ project, outputScopeKey, registrationKey, placementKey, estimate: value });
      recomputeEstimate({
        project,
        outputScope,
        jobOrigin,
        isCancelled: () => cancelled,
        isFollowUpStale: () => !mounted.current || workerGeneration.current !== generation,
        settleAt,
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

type RecomputeEstimateArgs = {
  readonly project: Project;
  readonly outputScope: ReturnType<typeof currentOutputScope>;
  readonly jobOrigin: JobOriginPlacement | undefined;
  readonly isCancelled: () => boolean;
  readonly isFollowUpStale: () => boolean;
  readonly settleAt: (value: LiveJobEstimate) => void;
};

function recomputeEstimate(args: RecomputeEstimateArgs): void {
  const { project, outputScope, jobOrigin } = args;
  const registration = currentPrintCutOutputRegistration(project);
  const usesSnapshot = hasVariableText(project) || registration !== undefined;
  const estimate = usesSnapshot
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
    if (args.isCancelled()) return;
    args.settleAt(value);
    followUpWithWorkerEstimate(args, value, usesSnapshot);
  });
}

// Over-budget scenes pause the synchronous estimate; the ADR-244 worker
// prepares the real one in the background (shared with the preview via the
// client's single-flight cache). Variable-text / registration projects stay
// paused: their snapshot pipeline cannot cross the worker boundary.
function followUpWithWorkerEstimate(
  args: RecomputeEstimateArgs,
  value: LiveJobEstimate,
  usesSnapshot: boolean,
): void {
  if (value.kind !== 'too-large' || usesSnapshot) return;
  const offThread = prepareLargeJobOffThread(args.project, {
    outputScope: args.outputScope,
    ...(args.jobOrigin === undefined ? {} : { jobOrigin: args.jobOrigin }),
  });
  if (offThread === null) return;
  offThread.then(
    (prepared) => {
      if (!args.isFollowUpStale()) args.settleAt(prepared.estimate);
    },
    () => undefined,
  );
}
