import type { Project, RasterImage, SceneObject } from '../../core/scene';
import { useStore } from '../state/store';
import { useUiStore } from '../state/ui-store';

export type TraceCommitOwner = {
  readonly projectDocumentEpoch: number;
  readonly source: RasterImage;
  readonly dialogRequestToken: string;
};

export type TraceCommitClaim = {
  readonly project: Project;
  readonly source: RasterImage;
};

/** Capture the exact live document, source object, and Trace-dialog request at submit. */
export function captureTraceCommitOwner(
  seed: RasterImage,
  dialogRequestToken: string,
): TraceCommitOwner | null {
  const dialog = useUiStore.getState().imageDialog;
  if (dialog?.requestToken !== dialogRequestToken || dialog.source !== seed) return null;

  const state = useStore.getState();
  const source = state.project.scene.objects.find((object) => object.id === seed.id);
  if (!sameTraceSourceContent(source, seed)) return null;
  return { projectDocumentEpoch: state.projectDocumentEpoch, source, dialogRequestToken };
}

/** Reclaim only the exact submission owner; value-equivalent replacements are stale. */
export function claimTraceCommitOwner(owner: TraceCommitOwner): TraceCommitClaim | null {
  const dialog = useUiStore.getState().imageDialog;
  if (dialog?.requestToken !== owner.dialogRequestToken) return null;

  const state = useStore.getState();
  if (state.projectDocumentEpoch !== owner.projectDocumentEpoch) return null;
  const source = state.project.scene.objects.find((object) => object.id === owner.source.id);
  if (source !== owner.source) return null;
  return { project: state.project, source: owner.source };
}

/** Close only the Trace dialog whose exact request initiated this commit. */
export function closeOwnedTraceDialog(dialogRequestToken: string): void {
  const state = useUiStore.getState();
  if (state.imageDialog?.requestToken === dialogRequestToken) state.closeImageDialog();
}

/**
 * Content eligibility used only while capturing an exact owner. Transforms may
 * change before Submit; source bytes and pixel-grid identity may not.
 */
export function sameTraceSourceContent(
  live: SceneObject | undefined,
  seed: RasterImage,
): live is RasterImage {
  return (
    live !== undefined &&
    live.kind === 'raster-image' &&
    live.dataUrl === seed.dataUrl &&
    live.imageAsset === seed.imageAsset &&
    live.pixelWidth === seed.pixelWidth &&
    live.pixelHeight === seed.pixelHeight
  );
}
