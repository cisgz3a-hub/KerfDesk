// Preview shows the job, not the design: the canvas only pans, the drawing
// tools do nothing, and the selection is not drawn. A click or an editing key
// there used to be ignored in silence, while Delete, the arrow keys and the
// flips still changed the hidden selection (annoyance audit A4-P2-5). Both now
// say why in one keyed line, so a second key rewrites the same toast.

import { useStore } from './store';
import { useToastStore } from './toast-store';

export const PREVIEW_EDIT_HINT =
  'Preview shows the job and cannot be edited. Press P or click Preview to go back to the design.';

/** The reason a disabled drawing tool gives in Preview. */
export const PREVIEW_TOOL_REASON = 'Not available in Preview. Press P or click Preview to edit.';

const HINT_KEY = 'preview-read-only';

// A click on the canvas says it once per visit to Preview: panning and looking
// around must not turn into a toast on every stray click.
let clickHintShown = false;
let watchingPreviewExit = false;

function showHint(): void {
  useToastStore.getState().pushToast(PREVIEW_EDIT_HINT, 'info', { key: HINT_KEY });
}

function watchPreviewExit(): void {
  if (watchingPreviewExit) return;
  watchingPreviewExit = true;
  useStore.subscribe((state, previous) => {
    if (state.previewMode || !previous.previewMode) return;
    clickHintShown = false;
    useToastStore.getState().dismissToastKey(HINT_KEY);
  });
}

/** A left click on the Preview canvas that did nothing. */
export function notePreviewIgnoredClick(): void {
  if (!useStore.getState().previewMode || clickHintShown) return;
  clickHintShown = true;
  watchPreviewExit();
  showHint();
}

/** An editing key or tool key pressed in Preview: nothing changes, and the hint says why. */
export function notePreviewBlockedEdit(): void {
  watchPreviewExit();
  showHint();
}

export function isPreviewActive(): boolean {
  return useStore.getState().previewMode;
}
