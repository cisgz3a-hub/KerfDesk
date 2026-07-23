// usePreviewToolpath schedules preview preparation outside render/draw so
// entering Preview can paint first and cancel stale builds before they start.

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildToolpath, EMPTY_JOB, type JobOriginPlacement } from '../../core/job';
import type { OutputScope, Project } from '../../core/scene';
import {
  resolveExportJobPlacement,
  resolveJobPlacement,
  type JobPlacementSettings,
} from '../job-placement';
import { useOutputScope, useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { buildPreviewToolpath, buildPreviewToolpathSnapshot } from './draw-preview';
import { prepareLargeJobOffThread } from './preparation-worker-client';
import { mapToolpathToScene } from './preview-scene-frame';
import type { PreviewToolpath } from './preview-status';
import { renderVariableText } from '../text/render-variable-text';
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
      if (cancelled) return;
      if (externalGcodePreview !== null) {
        setToolpath(mapToolpathToScene(externalGcodePreview.toolpath, ZERO_OFFSET, project.device));
        return;
      }
      const resolved = placementRef.current;
      if (!resolved.ok) {
        setToolpath({
          ...buildToolpath(EMPTY_JOB),
          previewIssue: { kind: 'placement-unavailable', messages: resolved.messages },
        });
        return;
      }
      const options = {
        ...(resolved.jobOrigin === undefined ? {} : { jobOrigin: resolved.jobOrigin }),
        outputScope,
      };
      const registration = currentPrintCutOutputRegistration(project);
      // The worker prepares plain projects only: variable text and print-cut
      // registration need the snapshot pipeline's clock/renderer, which
      // cannot cross the worker boundary.
      const needsSnapshot = hasVariableText(project) || registration !== undefined;
      const next = needsSnapshot
        ? buildPreviewToolpathSnapshot(project, {
            ...options,
            clock: () => new Date(),
            renderVariableText,
            ...(registration === undefined ? {} : { registration }),
          })
        : Promise.resolve(buildPreviewToolpath(project, options));
      void next.then((built) => {
        if (cancelled) return;
        settleBuiltToolpath({
          built,
          project,
          options,
          canPrepareOffThread: !needsSnapshot,
          isCancelled: () => cancelled,
          setToolpath,
        });
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
// superseded work is ignored through the cancellation generation.
function settleBuiltToolpath(args: {
  readonly built: PreviewToolpath;
  readonly project: Project;
  readonly options: { readonly jobOrigin?: JobOriginPlacement; readonly outputScope?: OutputScope };
  readonly canPrepareOffThread: boolean;
  readonly isCancelled: () => boolean;
  readonly setToolpath: (toolpath: PreviewToolpath) => void;
}): void {
  const { built, setToolpath } = args;
  const offThread =
    built.previewIssue?.kind === 'too-complex' && args.canPrepareOffThread
      ? prepareLargeJobOffThread(args.project, args.options)
      : null;
  if (offThread === null) {
    setToolpath(built);
    return;
  }
  setToolpath({ ...built, previewIssue: { kind: 'preparing-large-job' } });
  offThread.then(
    (prepared) => {
      if (!args.isCancelled()) setToolpath(prepared.toolpath);
    },
    (error: unknown) => {
      if (args.isCancelled()) return;
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
