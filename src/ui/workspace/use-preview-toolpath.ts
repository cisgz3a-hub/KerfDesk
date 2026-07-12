// usePreviewToolpath schedules preview preparation outside render/draw so
// entering Preview can paint first and cancel stale builds before they start.

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildToolpath, EMPTY_JOB } from '../../core/job';
import type { Project } from '../../core/scene';
import { resolveJobPlacement } from '../job-placement';
import { useOutputScope, useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { buildPreviewToolpath, buildPreviewToolpathSnapshot } from './draw-preview';
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
  const statusReport = useLaserStore((s) => s.statusReport);
  const workOriginActive = useLaserStore((s) => s.workOriginActive);
  const wcoCache = useLaserStore((s) => s.wcoCache);
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
  const placement = useMemo(
    () => resolveJobPlacement(jobPlacement, { statusReport, workOriginActive, wcoCache }),
    [jobPlacement, statusReport, workOriginActive, wcoCache],
  );
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
      const next =
        hasVariableText(project) || registration !== undefined
          ? buildPreviewToolpathSnapshot(project, {
              ...options,
              clock: () => new Date(),
              renderVariableText,
              ...(registration === undefined ? {} : { registration }),
            })
          : Promise.resolve(buildPreviewToolpath(project, options));
      void next.then((built) => {
        if (!cancelled) setToolpath(built);
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

function hasVariableText(project: Project): boolean {
  return project.scene.objects.some(
    (object) => object.kind === 'text' && object.variableTemplate !== undefined,
  );
}

function schedulePreviewBuild(work: () => void): () => void {
  const id = window.setTimeout(work, 0);
  return () => window.clearTimeout(id);
}
