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
import {
  estimateLiveJob,
  type LiveJobEstimate,
  type LiveJobEstimateOptions,
} from './live-job-estimate';
import { currentPrintCutOutputRegistration } from './print-cut-output';
import { useLaserStore } from '../state/laser-store';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { resolvePreviewJobPlacement, type ResolvedJobPlacement } from '../job-placement';
import {
  isPreparationSuperseded,
  prepareJobEstimateOffThread,
} from '../workspace/preparation-worker-client';
import { projectHasPagedRasterAssets } from '../import/paged-raster-hydration';
import { PRINT_CUT_REGISTRATION_INVALID_MESSAGE } from '../../io/gcode/prepare-output-snapshot';
import { costlyCanvasPreparation } from '../workspace/canvas-preparation-policy';
import { useSettledHeadPosition } from './settled-head-position';
import {
  useRuntimeCoordinatePreparation,
  type RuntimeCoordinatePreparation,
} from '../use-runtime-coordinate-preparation';

export const JOB_ESTIMATE_DEBOUNCE_MS = 250;

// Two panels mount this hook (Workspace and the job action controls), and
// each one recomputed the synchronous estimate on its own after every edit —
// a 90k-segment trace costs ~300 ms per estimate (the duration planner emits
// and times the whole program), so the UI thread paid that twice per edit.
// Memoize per immutable Project identity and exact inputs so the second mount
// reads the first one's result (ADR-346).
const memoizedEstimates = new WeakMap<Project, Map<string, LiveJobEstimate>>();

function memoizedLiveEstimate(
  project: Project,
  outputScope: OutputScope,
  jobOrigin: JobOriginPlacement | undefined,
  options: LiveJobEstimateOptions,
): LiveJobEstimate {
  const key = JSON.stringify({ outputScope, jobOrigin: jobOrigin ?? null, options });
  let byKey = memoizedEstimates.get(project);
  if (byKey === undefined) {
    byKey = new Map();
    memoizedEstimates.set(project, byKey);
  }
  const cached = byKey.get(key);
  if (cached !== undefined) return cached;
  const estimate = estimateLiveJob(project, outputScope, jobOrigin, options);
  byKey.set(key, estimate);
  return estimate;
}

type Settled = {
  readonly project: Project | null;
  readonly outputScopeKey: string;
  readonly registrationKey: string;
  readonly placementKey: string;
  readonly coordinateOptions: RuntimeCoordinatePreparation;
  readonly initialPosition: LiveJobEstimateOptions['initialPosition'];
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
  const coordinateOptions = useRuntimeCoordinatePreparation(project.device, resolvedPlacement);
  const placementKey = useMemo(() => JSON.stringify(resolvedPlacement), [resolvedPlacement]);
  const jobOrigin = useHeldJobOrigin(resolvedPlacement, placementKey);
  const initialPosition = useEstimateInitialPosition();
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
    coordinateOptions,
    jobOrigin,
    initialRegistration,
    initialPosition,
    initiallyAsync,
  });
}

// The physical head reaches the estimate only once it is settled; while a
// Frame, jog, probe or job moves it, the previous sample holds. Sampling every
// status report keyed a fresh background preparation per head move, and each
// one retains a complete prepared route — enough to exhaust the renderer
// during the Frame of a large traced fill.
function useEstimateInitialPosition(): LiveJobEstimateOptions['initialPosition'] {
  return useSettledHeadPosition();
}

function useEstimatePlacement(jobPlacement: ReturnType<typeof useStore.getState>['jobPlacement']) {
  const statusReport = useLaserStore((state) => state.statusReport);
  const workOriginActive = useLaserStore((state) => state.workOriginActive);
  const wcoCache = useLaserStore((state) => state.wcoCache);
  const reportInches = useLaserStore((state) => state.controllerSettings?.reportInches === true);
  return useMemo(() => {
    // Estimate and preview must resolve placement identically: the worker
    // client caches by jobOrigin, so a divergent resolution here made the
    // SAME over-budget project prepare twice, serially. The shared rule lives
    // in resolvePreviewJobPlacement (work-zero-relative modes fall back to the
    // export placement while the live resolution fails).
    return resolvePreviewJobPlacement(jobPlacement, {
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

type EstimateInputs = Omit<Settled, 'project' | 'estimate'> & {
  readonly project: Project;
  readonly outputScope: OutputScope;
  readonly jobOrigin: JobOriginPlacement | undefined;
  readonly initialRegistration: ReturnType<typeof currentPrintCutOutputRegistration>;
  readonly initiallyAsync: boolean;
};

function initialSettledEstimate(inputs: EstimateInputs): Settled {
  // Classify once on mount so unrelated renders do not repeat costly scans.
  const deferInitial =
    inputs.initiallyAsync || costlyCanvasPreparation(inputs.project, inputs.outputScope);
  const estimate = initialEstimate(inputs, deferInitial);
  return {
    // A synchronous size limit still needs a background request, even if
    // the project was already loaded when this panel mounted.
    project: deferInitial || estimate.kind === 'too-large' ? null : inputs.project,
    outputScopeKey: inputs.outputScopeKey,
    registrationKey: inputs.registrationKey,
    placementKey: inputs.placementKey,
    coordinateOptions: inputs.coordinateOptions,
    initialPosition: inputs.initialPosition,
    estimate,
  };
}

function useSettledEstimate(inputs: EstimateInputs): LiveJobEstimate {
  const {
    project,
    outputScope,
    outputScopeKey,
    registrationKey,
    placementKey,
    coordinateOptions,
    jobOrigin,
    initialPosition,
  } = inputs;
  // Compute cheap jobs synchronously; background jobs begin pending.
  const [settled, setSettled] = useState<Settled>(() => initialSettledEstimate(inputs));
  // The ADR-244 worker follow-up must survive the settle-triggered effect
  // cleanup (settling changes the deps and re-runs the effect), so it is
  // cancelled by GENERATION — newer inputs or unmount — not by the effect's
  // own cancelled flag. Invalidate on input change before the next debounce
  // fires, and on cleanup so StrictMode's replay starts a fresh generation.
  const workerGeneration = useRef(0);
  useEffect(
    () => () => {
      workerGeneration.current += 1;
    },
    [project, outputScopeKey, registrationKey, placementKey, coordinateOptions, initialPosition],
  );
  useEffect(() => {
    if (
      settled.project === project &&
      settled.outputScopeKey === outputScopeKey &&
      settled.registrationKey === registrationKey &&
      settled.placementKey === placementKey &&
      settled.coordinateOptions === coordinateOptions &&
      settled.initialPosition === initialPosition
    ) {
      return undefined;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      workerGeneration.current += 1;
      const generation = workerGeneration.current;
      const settleAt = (value: LiveJobEstimate): void =>
        setSettled({
          project,
          outputScopeKey,
          registrationKey,
          placementKey,
          coordinateOptions,
          initialPosition,
          estimate: value,
        });
      recomputeEstimate({
        project,
        outputScope,
        jobOrigin,
        coordinateOptions,
        initialPosition,
        isCancelled: () => cancelled,
        isFollowUpStale: () => workerGeneration.current !== generation,
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
    settled.coordinateOptions,
    settled.initialPosition,
    registrationKey,
    placementKey,
    coordinateOptions,
    jobOrigin,
    initialPosition,
  ]);
  return settled.estimate;
}

function initialEstimate(inputs: EstimateInputs, asyncSnapshot: boolean): LiveJobEstimate {
  if (inputs.initialRegistration === null) return invalidPrintCutEstimate();
  if (asyncSnapshot) return { kind: 'too-large' };
  return memoizedLiveEstimate(inputs.project, inputs.outputScope, inputs.jobOrigin, {
    ...inputs.coordinateOptions,
    ...(inputs.initialPosition === undefined ? {} : { initialPosition: inputs.initialPosition }),
  });
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
  readonly coordinateOptions: RuntimeCoordinatePreparation;
  readonly initialPosition: LiveJobEstimateOptions['initialPosition'];
  readonly isCancelled: () => boolean;
  readonly isFollowUpStale: () => boolean;
  readonly settleAt: (value: LiveJobEstimate) => void;
};

function recomputeEstimate(args: RecomputeEstimateArgs): void {
  const { project, outputScope, jobOrigin, initialPosition } = args;
  const options = {
    ...args.coordinateOptions,
    ...(initialPosition === undefined ? {} : { initialPosition }),
  };
  const registration = currentPrintCutOutputRegistration(project);
  const usesSnapshot =
    hasVariableText(project) || registration !== undefined || projectHasPagedRasterAssets(project);
  const estimate = Promise.resolve<LiveJobEstimate>(
    registration === null
      ? invalidPrintCutEstimate()
      : usesSnapshot
        ? { kind: 'too-large' }
        : memoizedLiveEstimate(project, outputScope, jobOrigin, options),
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
  const offThread = prepareJobEstimateOffThread(args.project, {
    ...args.coordinateOptions,
    outputScope: args.outputScope,
    ...(args.jobOrigin === undefined ? {} : { jobOrigin: args.jobOrigin }),
    ...(usesSnapshot
      ? {
          snapshot: {
            ...(registration === undefined ? {} : { registration }),
          },
        }
      : {}),
    ...(args.initialPosition === undefined ? {} : { initialPosition: args.initialPosition }),
  });
  if (offThread === null) return;
  offThread.then(
    (prepared) => {
      if (!args.isFollowUpStale()) args.settleAt(prepared.estimate);
    },
    (error: unknown) => {
      // A supersede means the client replaced this request with a newer one —
      // its own coalescing decision, not a failure. Keep the badge as it was:
      // during a jog (current-position placement re-keys per head move) this
      // rejection used to pin a false "Background estimate failed" for as
      // long as the head kept moving.
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
