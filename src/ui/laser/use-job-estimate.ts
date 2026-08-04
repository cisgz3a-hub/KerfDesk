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
import type { OutputScope, Project } from '../../core/scene';
import { useOutputScope, useStore } from '../state';
import { estimateLiveJob, type LiveJobEstimate } from './live-job-estimate';
import { currentPrintCutOutputRegistration } from './print-cut-output';
import { useLaserStore } from '../state/laser-store';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import {
  resolveExportJobPlacement,
  resolveJobPlacement,
  type ResolvedJobPlacement,
} from '../job-placement';
import {
  isPreparationSuperseded,
  prepareLargeJobOffThread,
} from '../workspace/preparation-worker-client';
import { projectHasPagedRasterAssets } from '../import/paged-raster-hydration';
import { PRINT_CUT_REGISTRATION_INVALID_MESSAGE } from '../../io/gcode/prepare-output-snapshot';

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
  // useOutputScope, not currentOutputScope(s): the raw selector returns a
  // fresh object per store update, so any unrelated change (a hover writing
  // cursorMm) re-rendered this hook and re-armed the debounce effect below,
  // starving the recompute while the mouse moved.
  const outputScope = useOutputScope();
  const jobPlacement = useStore((s) => s.jobPlacement);
  const outputScopeKey = useMemo(() => JSON.stringify(outputScope), [outputScope]);
  const positionEpoch = useLaserStore((state) => state.trustedPositionEpoch ?? 0);
  const firstRegistrationPoint = usePrintCutSessionStore((state) => state.first);
  const secondRegistrationPoint = usePrintCutSessionStore((state) => state.second);
  const resolvedPlacement = useEstimatePlacement(jobPlacement);
  const placementKey = useMemo(() => JSON.stringify(resolvedPlacement), [resolvedPlacement]);
  const jobOrigin = useHeldJobOrigin(resolvedPlacement, placementKey);
  const registrationKey = JSON.stringify({
    positionEpoch,
    firstRegistrationPoint,
    secondRegistrationPoint,
  });
  const initialRegistration = currentPrintCutOutputRegistration(project);
  const initiallyAsync =
    hasVariableText(project) ||
    initialRegistration !== undefined ||
    projectHasPagedRasterAssets(project);
  return useSettledEstimate({
    project,
    outputScope,
    outputScopeKey,
    registrationKey,
    placementKey,
    jobOrigin,
    initialRegistration,
    initiallyAsync,
  });
}

function useEstimatePlacement(jobPlacement: ReturnType<typeof useStore.getState>['jobPlacement']) {
  const statusReport = useLaserStore((state) => state.statusReport);
  const workOriginActive = useLaserStore((state) => state.workOriginActive);
  const wcoCache = useLaserStore((state) => state.wcoCache);
  const reportInches = useLaserStore((state) => state.controllerSettings?.reportInches === true);
  return useMemo(() => {
    // Estimate and preview must resolve placement identically: the worker
    // client caches by jobOrigin, so a divergent resolution here made the
    // SAME over-budget project prepare twice, serially. User Origin falls
    // back to its work-zero-relative export placement when the live
    // resolution fails (disconnected / origin unset) — the same rule
    // usePreviewPlacement in use-preview-toolpath.ts applies.
    const resolvePlacement =
      jobPlacement.startFrom === 'user-origin' ? resolveExportJobPlacement : resolveJobPlacement;
    return resolvePlacement(jobPlacement, {
      statusReport,
      workOriginActive,
      wcoCache,
      reportInches,
    });
  }, [jobPlacement, statusReport, workOriginActive, wcoCache, reportInches]);
}

// A connected controller stores a freshly parsed status report on every poll,
// so useEstimatePlacement re-resolves each time and every resolver in
// job-placement.ts returns a NEW jobOrigin literal — even when the resolved
// placement is byte-identical. useSettledEstimate's debounce effect tracks
// jobOrigin BY REFERENCE, so that churn cancelled and re-armed the 250 ms timer
// once per poll: on a connected machine the estimate could never settle. Hold
// the resolved jobOrigin until its semantic key changes so identity follows
// meaning. The worker cache keys on the jobOrigin VALUE
// (preparation-worker-client.requestKey), so preview and estimate still share
// a single preparation entry.
function useHeldJobOrigin(
  placement: ResolvedJobPlacement,
  placementKey: string,
): JobOriginPlacement | undefined {
  // Keyed on placementKey alone, which IS JSON.stringify(placement): holding by
  // semantic key is the whole point, so depending on the per-poll-fresh
  // placement identity would defeat it. Memo rather than a render-time ref
  // write, so a render React discards leaves nothing behind.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => jobOriginOf(placement), [placementKey]);
}

function jobOriginOf(placement: ResolvedJobPlacement): JobOriginPlacement | undefined {
  return placement.ok ? placement.jobOrigin : undefined;
}

function useSettledEstimate({
  project,
  outputScope,
  outputScopeKey,
  registrationKey,
  placementKey,
  jobOrigin,
  initialRegistration,
  initiallyAsync,
}: {
  readonly project: Project;
  readonly outputScope: OutputScope;
  readonly outputScopeKey: string;
  readonly registrationKey: string;
  readonly placementKey: string;
  readonly jobOrigin: JobOriginPlacement | undefined;
  readonly initialRegistration: ReturnType<typeof currentPrintCutOutputRegistration>;
  readonly initiallyAsync: boolean;
}): LiveJobEstimate {
  // Compute only cheap jobs on mount. Snapshot-backed jobs need variable-text,
  // paged-asset, or Print-and-Cut materialization and therefore begin paused
  // (or with the already-known registration failure) until the background
  // preparation settles.
  const [settled, setSettled] = useState<Settled>(() => ({
    project: initiallyAsync ? null : project,
    outputScopeKey,
    registrationKey,
    placementKey,
    estimate: initialEstimate(project, outputScope, jobOrigin, initialRegistration, initiallyAsync),
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

function initialEstimate(
  project: Project,
  outputScope: OutputScope,
  jobOrigin: JobOriginPlacement | undefined,
  registration: ReturnType<typeof currentPrintCutOutputRegistration>,
  asyncSnapshot: boolean,
): LiveJobEstimate {
  if (registration === null) return invalidPrintCutEstimate();
  if (asyncSnapshot) return { kind: 'too-large' };
  return estimateLiveJob(project, outputScope, jobOrigin);
}

function hasVariableText(project: Project): boolean {
  return project.scene.objects.some(
    (object) => object.kind === 'text' && object.variableTemplate !== undefined,
  );
}

type RecomputeEstimateArgs = {
  readonly project: Project;
  readonly outputScope: OutputScope;
  readonly jobOrigin: JobOriginPlacement | undefined;
  readonly isCancelled: () => boolean;
  readonly isFollowUpStale: () => boolean;
  readonly settleAt: (value: LiveJobEstimate) => void;
};

function recomputeEstimate(args: RecomputeEstimateArgs): void {
  const { project, outputScope, jobOrigin } = args;
  const registration = currentPrintCutOutputRegistration(project);
  const usesSnapshot =
    hasVariableText(project) || registration !== undefined || projectHasPagedRasterAssets(project);
  const estimate = Promise.resolve<LiveJobEstimate>(
    registration === null
      ? invalidPrintCutEstimate()
      : usesSnapshot
        ? { kind: 'too-large' }
        : estimateLiveJob(project, outputScope, jobOrigin),
  );
  void estimate.then((value) => {
    if (args.isCancelled()) return;
    args.settleAt(value);
    followUpWithWorkerEstimate(args, value, usesSnapshot);
  });
}

function invalidPrintCutEstimate(): LiveJobEstimate {
  return {
    kind: 'preparation-failed',
    message: PRINT_CUT_REGISTRATION_INVALID_MESSAGE,
  };
}

// Over-budget scenes pause the synchronous estimate; the ADR-244 worker
// prepares the real one in the background (shared with the preview via the
// client's single-flight cache), including variable-text/registration snapshots.
function followUpWithWorkerEstimate(
  args: RecomputeEstimateArgs,
  value: LiveJobEstimate,
  usesSnapshot: boolean,
): void {
  if (value.kind !== 'too-large') return;
  const registration = currentPrintCutOutputRegistration(args.project);
  const offThread = prepareLargeJobOffThread(args.project, {
    outputScope: args.outputScope,
    ...(args.jobOrigin === undefined ? {} : { jobOrigin: args.jobOrigin }),
    ...(usesSnapshot
      ? {
          snapshot: {
            ...(registration === undefined ? {} : { registration }),
          },
        }
      : {}),
  });
  if (offThread === null) return;
  offThread.then(
    (prepared) => {
      if (!args.isFollowUpStale()) args.settleAt(prepared.estimate);
    },
    (error: unknown) => {
      // A supersede means the client replaced this request with a newer one —
      // its own coalescing decision, not a failure. Keep the badge as it was:
      // isFollowUpStale() only advances when the debounce FIRES, so during a
      // jog (current-position placement re-keys per head move) this rejection
      // lands inside the debounce window and used to pin a false
      // "Background estimate failed" for as long as the head kept moving.
      if (isPreparationSuperseded(error) || args.isFollowUpStale()) return;
      args.settleAt({
        kind: 'preparation-failed',
        message: `Background estimate failed: ${
          error instanceof Error ? error.message : String(error)
        }. Edit the job to retry.`,
      });
    },
  );
}
