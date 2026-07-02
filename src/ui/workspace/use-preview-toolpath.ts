// usePreviewToolpath — derives the preview toolpath for the workspace canvas
// from the current project, placement, and live machine state. Lifted out of
// the Workspace component (and out of useWorkspaceDraw) so the preview status
// overlays (M27) can read emptiness without preparing the job a second time.

import { useMemo } from 'react';
import { buildToolpath, EMPTY_JOB } from '../../core/job';
import type { Project } from '../../core/scene';
import { resolveJobPlacement } from '../job-placement';
import { currentOutputScope, useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { buildPreviewToolpath } from './draw-preview';
import { mapToolpathToScene } from './preview-scene-frame';
import type { PreviewToolpath } from './preview-status';

const ZERO_OFFSET = { x: 0, y: 0 } as const;

export function usePreviewToolpath(project: Project, previewMode: boolean): PreviewToolpath | null {
  const jobPlacement = useStore((s) => s.jobPlacement);
  const outputScope = useStore((s) => currentOutputScope(s));
  const externalGcodePreview = useStore((s) => s.externalGcodePreview);
  const statusReport = useLaserStore((s) => s.statusReport);
  const workOriginActive = useLaserStore((s) => s.workOriginActive);
  const wcoCache = useLaserStore((s) => s.wcoCache);
  return useMemo(() => {
    if (!previewMode) return null;
    // An opened .nc program (F-CNC10) REPLACES the compiled toolpath: it is
    // already in machine coordinates, so it maps to scene space with a zero
    // job-origin offset.
    if (externalGcodePreview !== null) {
      return mapToolpathToScene(externalGcodePreview.toolpath, ZERO_OFFSET, project.device);
    }
    const placement = resolveJobPlacement(jobPlacement, {
      statusReport,
      workOriginActive,
      wcoCache,
    });
    if (!placement.ok) return buildToolpath(EMPTY_JOB);
    return buildPreviewToolpath(project, {
      ...(placement.jobOrigin === undefined ? {} : { jobOrigin: placement.jobOrigin }),
      outputScope,
    });
  }, [
    previewMode,
    project,
    jobPlacement,
    outputScope,
    externalGcodePreview,
    statusReport,
    workOriginActive,
    wcoCache,
  ]);
}
