// usePreviewToolpath schedules preview preparation outside render/draw so
// entering Preview can paint first and cancel stale builds before they start.

import { useEffect, useMemo, useState } from 'react';
import { buildToolpath, EMPTY_JOB } from '../../core/job';
import type { Project } from '../../core/scene';
import { resolveJobPlacement } from '../job-placement';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { buildPreviewToolpath } from './draw-preview';
import { mapToolpathToScene } from './preview-scene-frame';
import type { PreviewToolpath } from './preview-status';

export type PreviewBuildScheduler = (work: () => void) => () => void;

const ZERO_OFFSET = { x: 0, y: 0 } as const;

export function usePreviewToolpath(
  project: Project,
  previewMode: boolean,
  scheduleBuild: PreviewBuildScheduler = schedulePreviewBuild,
): PreviewToolpath | null {
  const jobPlacement = useStore((s) => s.jobPlacement);
  const cutSelectedGraphics = useStore((s) => s.outputScopeSettings.cutSelectedGraphics);
  const useSelectionOrigin = useStore((s) => s.outputScopeSettings.useSelectionOrigin);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const additionalSelectedIds = useStore((s) => s.additionalSelectedIds);
  const externalGcodePreview = useStore((s) => s.externalGcodePreview);
  const statusReport = useLaserStore((s) => s.statusReport);
  const workOriginActive = useLaserStore((s) => s.workOriginActive);
  const wcoCache = useLaserStore((s) => s.wcoCache);
  const [toolpath, setToolpath] = useState<PreviewToolpath | null>(null);
  const outputScope = useMemo(
    () => ({
      cutSelectedGraphics,
      useSelectionOrigin,
      selectedObjectIds: [
        ...(selectedObjectId === null ? [] : [selectedObjectId]),
        ...additionalSelectedIds,
      ],
    }),
    [additionalSelectedIds, cutSelectedGraphics, selectedObjectId, useSelectionOrigin],
  );

  useEffect(() => {
    if (!previewMode) {
      setToolpath(null);
      return;
    }
    setToolpath(null);
    let cancelled = false;
    const cancelScheduledBuild = scheduleBuild(() => {
      if (cancelled) return;
      if (externalGcodePreview !== null) {
        setToolpath(mapToolpathToScene(externalGcodePreview.toolpath, ZERO_OFFSET, project.device));
        return;
      }
      const placement = resolveJobPlacement(jobPlacement, {
        statusReport,
        workOriginActive,
        wcoCache,
      });
      const next = !placement.ok
        ? buildToolpath(EMPTY_JOB)
        : buildPreviewToolpath(project, {
            ...(placement.jobOrigin === undefined ? {} : { jobOrigin: placement.jobOrigin }),
            outputScope,
          });
      if (!cancelled) setToolpath(next);
    });
    return () => {
      cancelled = true;
      cancelScheduledBuild();
    };
  }, [
    previewMode,
    project,
    jobPlacement,
    outputScope,
    externalGcodePreview,
    statusReport,
    workOriginActive,
    wcoCache,
    scheduleBuild,
  ]);

  return toolpath;
}

function schedulePreviewBuild(work: () => void): () => void {
  const id = window.setTimeout(work, 0);
  return () => window.clearTimeout(id);
}
