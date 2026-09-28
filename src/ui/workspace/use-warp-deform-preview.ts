// The live Warp and Deform preview (LBG-T06): the canvas draws a copy of the
// project with the artwork bent by the current handles, built by the same plan
// Apply uses, so what the user sees is what Apply makes. The real project, its
// output and its undo history are untouched until Apply.

import { useMemo } from 'react';
import { warpDeformHandlesUnmoved } from '../../core/geometry/warp-deform-map';
import type { Project } from '../../core/scene/project';
import { useUiStore } from '../state/ui-store';
import { planWarpDeform } from '../state/warp-deform-plan';
import { useWarpDeformSession, type WarpDeformRequest } from '../state/warp-deform-session';
import { activeWarpDeformSession } from './warp-deform-tool';
import { canvasTextSelection, useCanvasTextDisplayProject } from './workspace-text-interaction';

export function useActiveWarpDeformSession(): WarpDeformRequest | null {
  const mode = useUiStore((state) => state.toolMode);
  const session = useWarpDeformSession((state) => state.session);
  return activeWarpDeformSession(mode, session);
}

/**
 * What the canvas draws: the project with any canvas text draft and any
 * bent Warp or Deform artwork in place, and the selection to outline. While
 * Warp or Deform is on, its handles are drawn instead of the selection box.
 * Preview mode shows the real project.
 */
export function useCanvasDisplay(
  project: Project,
  previewMode: boolean,
  selectedObjectId: string | null,
  additionalSelectedIds: ReadonlySet<string>,
): {
  readonly project: Project;
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly warpDeformEditor?: WarpDeformRequest;
} {
  const { displayProject, textEditing } = useCanvasTextDisplayProject(project, previewMode);
  const session = useActiveWarpDeformSession();
  const editor = previewMode ? null : session;
  const display = useMemo(
    () => warpDeformDisplayProject(displayProject, editor),
    [displayProject, editor],
  );
  return {
    project: display,
    ...canvasTextSelection(textEditing || editor !== null, selectedObjectId, additionalSelectedIds),
    ...(editor === null ? {} : { warpDeformEditor: editor }),
  };
}

export function warpDeformDisplayProject(
  project: Project,
  session: WarpDeformRequest | null,
): Project {
  if (session === null || warpDeformHandlesUnmoved(session.grid, session.box, session.handles)) {
    return project;
  }
  const plan = planWarpDeform(project.scene, session);
  return { ...project, scene: { ...project.scene, objects: plan.objects } };
}
