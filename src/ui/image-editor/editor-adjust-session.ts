// Adjustment ↔ session bridge (ADR-242, PP-E): turn a catalog entry into
// either a committed session edit (ONE history entry, selection-clamped) or
// a non-destructive full-resolution preview of what that edit produces.

import type { CurvePoint } from '../../core/image-adjust';
import { pushHistoryEntry } from '../../core/image-edit';
import type { RgbaBuffer } from '../../core/image-edit';
import { maskBounds } from '../../core/image-select';
import { computeWindowPreview, fullPreviewWindow } from './adjust-preview-window';
import { adjustmentById, runAdjustment, type AdjustmentId } from './editor-adjustments';
import { BACKGROUND_LAYER_ID } from './editor-layer-clear';
import { captureScoped, type EditorSession } from './editor-session';

/** Apply the adjustment to the working document as one undoable step. */
export function commitAdjustment(
  session: EditorSession,
  id: AdjustmentId,
  params: Readonly<Record<string, number>>,
  curvePoints?: readonly CurvePoint[],
): EditorSession {
  const bounds = session.selection === null ? null : maskBounds(session.selection);
  const captured = bounds ?? { x: 0, y: 0, width: session.doc.width, height: session.doc.height };
  const entry = captureScoped(session, captured, adjustmentById(id).label);
  runAdjustment(
    id,
    params,
    session.doc,
    bounds,
    session.selection,
    curvePoints,
    undefined,
    session.activeLayerId === BACKGROUND_LAYER_ID,
  );
  return {
    ...session,
    history: pushHistoryEntry(session.history, entry),
    revision: session.revision + 1,
    dirtySinceApply: true,
    lastDirtyRect: captured,
  };
}

/**
 * The full-resolution preview: the document is never touched. It is the
 * full composite with the adjusted active layer substituted in, so what it
 * shows is what OK produces (ADR-245). The dialog itself previews only the
 * visible window at display resolution (adjust-preview-window.ts); at 1:1
 * that window is a crop of this buffer.
 */
export function computeAdjustPreview(
  session: EditorSession,
  id: AdjustmentId,
  params: Readonly<Record<string, number>>,
  curvePoints?: readonly CurvePoint[],
): RgbaBuffer {
  const request = { id, params, curvePoints };
  return computeWindowPreview({ current: null }, session, request, fullPreviewWindow(session.doc));
}
