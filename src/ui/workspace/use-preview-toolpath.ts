// usePreviewToolpath — derives the preview toolpath for the workspace canvas
// from the current project, placement, and live machine state. Lifted out of
// the Workspace component (and out of useWorkspaceDraw) so the preview status
// overlays (M27) can read emptiness without preparing the job a second time.

import { useMemo } from 'react';
import { buildToolpath, EMPTY_JOB, type Toolpath } from '../../core/job';
import type { Project } from '../../core/scene';
import { resolveJobPlacement } from '../job-placement';
import { currentOutputScope, useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { buildPreviewToolpath } from './draw-preview';

export function usePreviewToolpath(project: Project, previewMode: boolean): Toolpath | null {
  const jobPlacement = useStore((s) => s.jobPlacement);
  const outputScope = useStore((s) => currentOutputScope(s));
  const statusReport = useLaserStore((s) => s.statusReport);
  const workOriginActive = useLaserStore((s) => s.workOriginActive);
  const wcoCache = useLaserStore((s) => s.wcoCache);
  return useMemo(() => {
    if (!previewMode) return null;
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
  }, [previewMode, project, jobPlacement, outputScope, statusReport, workOriginActive, wcoCache]);
}
