// Adjustment ↔ session bridge (ADR-242, PP-E): turn a catalog entry into
// either a committed session edit (ONE history entry, selection-clamped) or
// a non-destructive preview buffer the canvas draws instead of the document.

import { captureRect, cloneRgbaBuffer, pushHistoryEntry } from '../../core/image-edit';
import type { PixelRect, RgbaBuffer } from '../../core/image-edit';
import { maskBounds } from '../../core/image-select';
import { adjustmentById, runAdjustment, type AdjustmentId } from './editor-adjustments';
import type { EditorSession } from './editor-session';

function selectionRect(session: EditorSession): PixelRect | null {
  return session.selection === null ? null : maskBounds(session.selection);
}

/** Apply the adjustment to the working document as one undoable step. */
export function commitAdjustment(
  session: EditorSession,
  id: AdjustmentId,
  params: Readonly<Record<string, number>>,
): EditorSession {
  const bounds = selectionRect(session);
  const captured = bounds ?? { x: 0, y: 0, width: session.doc.width, height: session.doc.height };
  const entry = captureRect(session.doc, captured, adjustmentById(id).label);
  runAdjustment(id, params, session.doc, bounds, session.selection);
  return {
    ...session,
    history: pushHistoryEntry(session.history, entry),
    revision: session.revision + 1,
    dirtySinceApply: true,
  };
}

/** The dialog's live preview: the document is never touched. */
export function computeAdjustPreview(
  session: EditorSession,
  id: AdjustmentId,
  params: Readonly<Record<string, number>>,
): RgbaBuffer {
  const clone = cloneRgbaBuffer(session.doc);
  runAdjustment(id, params, clone, selectionRect(session), session.selection);
  return clone;
}
