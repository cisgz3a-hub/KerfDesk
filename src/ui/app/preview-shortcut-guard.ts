// In Preview the canvas shows the job and not the selection, so a key that
// would delete, paste, move, turn, flip or restack artwork must not change a
// selection the user cannot see (annoyance audit A4-P2-5). Each guard swaps the
// editing actions of a shortcut context for the Preview hint. The key is still
// matched and consumed exactly as before, so Ctrl+D never reaches the browser's
// bookmark and Alt+Left never goes Back.
//
// Undo, Redo, Copy, Select All, Esc, the view keys and P are left alone: they
// either change nothing in the design or are how Preview is used and left.

import { isPreviewActive, notePreviewBlockedEdit } from '../state/preview-edit-hint';
import type { ArrangeShortcutCtx } from './arrange-shortcuts';
import type { EditingToolCtx } from './editing-tool-shortcuts';
import type { EditCtx, ToolCtx, TransformCtx } from './shortcuts';

const hint = (): void => notePreviewBlockedEdit();

export function editCtxForPreview(ctx: EditCtx): EditCtx {
  if (!isPreviewActive()) return ctx;
  return {
    ...ctx,
    removeSceneObjects: hint,
    deleteSelectedPathNodes: hint,
    cutSelection: hint,
    pasteClipboard: hint,
    groupSelection: hint,
    ungroupSelection: hint,
    duplicateSelection: hint,
  };
}

export function transformCtxForPreview(ctx: TransformCtx): TransformCtx {
  if (!isPreviewActive()) return ctx;
  return {
    ...ctx,
    applyObjectTransform: hint,
    nudgeSelection: hint,
    nudgeSelectedPathNode: hint,
    flipSelection: hint,
  };
}

export function editingToolCtxForPreview(ctx: EditingToolCtx): EditingToolCtx {
  if (!isPreviewActive()) return ctx;
  return {
    ...ctx,
    rotateSelectionQuarterTurn: hint,
    rotateSelectionBy: hint,
    flipSelection: hint,
    pasteClipboardInPlace: hint,
    deleteDuplicates: hint,
  };
}

export function arrangeCtxForPreview(ctx: ArrangeShortcutCtx): ArrangeShortcutCtx {
  if (!isPreviewActive()) return ctx;
  return {
    ...ctx,
    alignSelection: hint,
    moveSelectionTogether: hint,
    moveSelectionInDrawOrder: hint,
  };
}

/** A drawing tool armed in Preview would do nothing: the canvas only pans there. */
export function toolCtxForPreview(ctx: ToolCtx): ToolCtx {
  if (!isPreviewActive()) return ctx;
  return { ...ctx, setToolMode: hint };
}
