// The live Warp and Deform preview (LBG-T06): the canvas draws a copy of the
// project with the artwork bent by the current handles, built by the same plan
// Apply uses, so what the user sees is what Apply makes. The real project, its
// output and its undo history are untouched until Apply. A bend the plan
// refuses leaves the artwork drawn unbent, with the plan's reason beside it.

import { useMemo } from 'react';
import { warpDeformHandlesUnmoved } from '../../core/geometry/warp-deform-map';
import type { Project } from '../../core/scene/project';
import { useUiStore } from '../state/ui-store';
import { planWarpDeform } from '../state/warp-deform-plan';
import { useWarpDeformSession, type WarpDeformRequest } from '../state/warp-deform-session';
import { useVariableBarcodeDisplay } from './variable-barcode-display';
import { activeWarpDeformSession } from './warp-deform-tool';
import { canvasTextSelection, useCanvasTextDisplayProject } from './workspace-text-interaction';

export type WarpDeformPreview = {
  readonly project: Project;
  /** Why the current bend cannot be made, worded as Apply says it; null when it can. */
  readonly failure: string | null;
};

export function useActiveWarpDeformSession(): WarpDeformRequest | null {
  const mode = useUiStore((state) => state.toolMode);
  const session = useWarpDeformSession((state) => state.session);
  return activeWarpDeformSession(mode, session);
}

/**
 * What the canvas draws: the project with each variable barcode showing its
 * current value, any canvas text draft and any bent Warp or Deform artwork in
 * place, and the selection to outline. While Warp or Deform is on, its handles
 * are drawn instead of the selection box, and a bend it cannot make gives its
 * reason. Preview mode shows the real project, with variable barcodes at their
 * current value as output encodes them.
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
  readonly warpDeformFailure: string | null;
} {
  const current = useVariableBarcodeDisplay(project);
  const { displayProject, textEditing } = useCanvasTextDisplayProject(current, previewMode);
  const session = useActiveWarpDeformSession();
  const editor = previewMode ? null : session;
  const preview = useMemo(
    () => warpDeformPreview(displayProject, editor),
    [displayProject, editor],
  );
  return {
    project: preview.project,
    ...canvasTextSelection(textEditing || editor !== null, selectedObjectId, additionalSelectedIds),
    ...(editor === null ? {} : { warpDeformEditor: editor }),
    warpDeformFailure: preview.failure,
  };
}

export function warpDeformPreview(
  project: Project,
  session: WarpDeformRequest | null,
): WarpDeformPreview {
  if (session === null || warpDeformHandlesUnmoved(session.grid, session.box, session.handles)) {
    return { project, failure: null };
  }
  const plan = planWarpDeform(project.scene, session);
  if (plan.failure !== undefined) return { project, failure: plan.failure };
  return {
    project: { ...project, scene: { ...project.scene, objects: plan.objects } },
    failure: null,
  };
}
