// usePreviewToolpath schedules preview preparation outside render/draw so
// entering Preview can paint first and cancel stale builds before they start.

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildToolpath, EMPTY_JOB } from '../../core/job';
import type { Project } from '../../core/scene';
import {
  resolveExportJobPlacement,
  resolveJobPlacement,
  type JobPlacementSettings,
} from '../job-placement';
import { useOutputScope, useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { buildPreviewToolpath } from './draw-preview';
import {
  isPreparationSuperseded,
  prepareLargeJobOffThread,
  type LargeJobPreparationOptions,
} from './preparation-worker-client';
import { mapToolpathToScene, registerPreviewJobOriginOffset } from './preview-scene-frame';
import type { PreviewToolpath } from './preview-status';
import { currentPrintCutOutputRegistration } from '../laser/print-cut-output';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';

export type PreviewBuildScheduler = (work: () => void) => () => void;

const ZERO_OFFSET = { x: 0, y: 0 } as const;

export function usePreviewToolpath(
  project: Project,
  previewMode: boolean,
  scheduleBuild: PreviewBuildScheduler = schedulePreviewBuild,
): PreviewToolpath | null {
  const jobPlacement = useStore((s) => s.jobPlacement);
  const externalGcodePreview = useStore((s) => s.externalGcodePreview);
  const positionEpoch = useLaserStore((s) => s.trustedPositionEpoch ?? 0);
  const firstRegistrationPoint = usePrintCutSessionStore((s) => s.first);
  const secondRegistrationPoint = usePrintCutSessionStore((s) => s.second);
  const [toolpath, setToolpath] = useState<PreviewToolpath | null>(null);
  const outputScope = useOutputScope();

  // Resolve the placement during render (cheap) and key the rebuild on the
  // RESOLVED placement, not the raw statusReport — a connected controller stores
  // a fresh report object every 250 ms poll, but in absolute/user/verified modes
  // the resolved placement is byte-identical across polls, so the preview should
  // not rebuild. In current-position mode the origin tracks mPos, so the key
  // changes as the head moves (a legitimate rebuild).
  const placement = usePreviewPlacement(jobPlacement);
  const placementKey = useMemo(() => JSON.stringify(placement), [placement]);
  // The scheduled build reads the latest resolved placement via a ref so the
  // placement object itself need not be an effect dependency.
  const placementRef = useRef(placement);
  placementRef.current = placement;

  useEffect(() => {
    if (!previewMode) {
      setToolpath(null);
      return;
    }
    // NB: no setToolpath(null) here — keep the previous route painted until the
    // new build resolves so a genuine rebuild doesn't blank the preview.
    let cancelled = false;
    const cancelScheduledBuild = scheduleBuild(() => {
      runScheduledPreviewBuild({
        project,
        externalGcodePreview,
        placement: placementRef.current,
        outputScope,
        isCancelled: () => cancelled,
        setToolpath,
      });
    });
    return () => {
      cancelled = true;
      cancelScheduledBuild();
    };
  }, [
    previewMode,
    project,
    outputScope,
    externalGcodePreview,
    placementKey,
    scheduleBuild,
    positionEpoch,
    firstRegistrationPoint,
    secondRegistrationPoint,
  ]);

  return toolpath;
}

function runScheduledPreviewBuild(args: {
  readonly project: Project;
  readonly externalGcodePreview: ReturnType<typeof useStore.getState>['externalGcodePreview'];
  readonly placement: ReturnType<typeof usePreviewPlacement>;
  readonly outputScope: NonNullable<LargeJobPreparationOptions['outputScope']>;
  readonly isCancelled: () => boolean;
  readonly setToolpath: (toolpath: PreviewToolpath | null) => void;
}): void {
  if (args.isCancelled()) return;
  if (args.externalGcodePreview !== null) {
    const external = mapToolpathToScene(
      args.externalGcodePreview.toolpath,
      ZERO_OFFSET,
      args.project.device,
    );
    registerPreviewJobOriginOffset(external, ZERO_OFFSET);
    args.setToolpath(external);
    return;
  }
  const resolved = args.placement;
  if (!resolved.ok) {
    args.setToolpath({
      ...buildToolpath(EMPTY_JOB),
      previewIssue: { kind: 'placement-unavailable', messages: resolved.messages },
    });
    return;
  }
  const options: LargeJobPreparationOptions = {
    ...(resolved.jobOrigin === undefined ? {} : { jobOrigin: resolved.jobOrigin }),
    outputScope: args.outputScope,
  };
  const registration = currentPrintCutOutputRegistration(args.project);
  const needsSnapshot = hasVariableText(args.project) || registration !== undefined;
  const backgroundOptions: LargeJobPreparationOptions = {
    ...options,
    ...(needsSnapshot
      ? { snapshot: { ...(registration === undefined ? {} : { registration }) } }
      : {}),
  };
  const next = Promise.resolve(
    needsSnapshot
      ? { ...buildToolpath(EMPTY_JOB), previewIssue: { kind: 'too-complex' as const } }
      : buildPreviewToolpath(args.project, options),
  );
  void next.then((built) => {
    if (args.isCancelled()) return;
    settleBuiltToolpath({
      built,
      project: args.project,
      options: backgroundOptions,
      isCancelled: args.isCancelled,
      setToolpath: args.setToolpath,
    });
  });
}

function usePreviewPlacement(jobPlacement: JobPlacementSettings) {
  const statusReport = useLaserStore((state) => state.statusReport);
  const workOriginActive = useLaserStore((state) => state.workOriginActive);
  const wcoCache = useLaserStore((state) => state.wcoCache);
  const reportInches = useLaserStore((state) => state.controllerSettings?.reportInches === true);
  return useMemo(() => {
    // Preview does not move the machine. User Origin output is work-zero
    // relative, so it can be inspected before the controller origin is set.
    // Start still uses resolveJobPlacement and remains blocked.
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

function hasVariableText(project: Project): boolean {
  return project.scene.objects.some(
    (object) => object.kind === 'text' && object.variableTemplate !== undefined,
  );
}

// Over-budget scenes pause the synchronous preview; the ADR-244 worker
// prepares the real toolpath in the background and fills the canvas in when
// done. A real worker failure becomes an explicit retryable preview issue;
// superseded work is ignored — through the cancellation flag when the effect
// re-ran, and through PreparationSupersededError when the client coalesced
// the request without this effect being torn down.
function settleBuiltToolpath(args: {
  readonly built: PreviewToolpath;
  readonly project: Project;
  readonly options: LargeJobPreparationOptions;
  readonly isCancelled: () => boolean;
  readonly setToolpath: (toolpath: PreviewToolpath) => void;
}): void {
  const { built, setToolpath } = args;
  const offThread =
    built.previewIssue?.kind === 'too-complex'
      ? prepareLargeJobOffThread(args.project, args.options)
      : null;
  if (offThread === null) {
    setToolpath(built);
    return;
  }
  setToolpath({ ...built, previewIssue: { kind: 'preparing-large-job' } });
  offThread.then(
    (prepared) => {
      if (args.isCancelled()) return;
      registerPreviewJobOriginOffset(prepared.toolpath, prepared.jobOriginOffset ?? ZERO_OFFSET);
      setToolpath(prepared.toolpath);
    },
    (error: unknown) => {
      // Superseded means a newer preparation already replaced this one, so the
      // canvas keeps waiting on that one instead of reporting a failure the
      // operator can neither act on nor have caused.
      if (isPreparationSuperseded(error) || args.isCancelled()) return;
      const message = error instanceof Error ? error.message : String(error);
      setToolpath({
        ...built,
        previewIssue: {
          kind: 'preparation-failed',
          messages: [
            `Background preparation failed: ${message}. Edit the job or reopen Preview to retry.`,
          ],
        },
      });
    },
  );
}

function schedulePreviewBuild(work: () => void): () => void {
  const id = window.setTimeout(work, 0);
  return () => window.clearTimeout(id);
}
