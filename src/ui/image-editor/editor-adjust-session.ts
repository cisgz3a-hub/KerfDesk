// Adjustment ↔ session bridge (ADR-242, PP-E): turn a catalog entry into
// either a committed session edit (ONE history entry, selection-clamped) or
// a non-destructive preview buffer the canvas draws instead of the document.

import { applyLutInPlace, curveLut, type CurvePoint } from '../../core/image-adjust';
import { cloneRgbaBuffer, pushHistoryEntry } from '../../core/image-edit';
import type { PixelRect, RgbaBuffer } from '../../core/image-edit';
import { maskBounds, type SelectionMask } from '../../core/image-select';
import { adjustmentById, runAdjustment, type AdjustmentId } from './editor-adjustments';
import { captureScoped, type EditorSession } from './editor-session';
import { compositeSession } from './editor-session-layers';

function selectionRect(session: EditorSession): PixelRect | null {
  return session.selection === null ? null : maskBounds(session.selection);
}

// Curves carries its point list outside the numeric-params record; every
// other id dispatches through the catalog runner.
function runOp(
  id: AdjustmentId,
  params: Readonly<Record<string, number>>,
  curvePoints: readonly CurvePoint[] | undefined,
  doc: RgbaBuffer,
  rect: PixelRect | null,
  mask: SelectionMask | null,
): void {
  if (id === 'curves' && curvePoints !== undefined) {
    applyLutInPlace(doc, curveLut(curvePoints), rect, mask);
    return;
  }
  runAdjustment(id, params, doc, rect, mask);
}

/** Apply the adjustment to the working document as one undoable step. */
export function commitAdjustment(
  session: EditorSession,
  id: AdjustmentId,
  params: Readonly<Record<string, number>>,
  curvePoints?: readonly CurvePoint[],
): EditorSession {
  const bounds = selectionRect(session);
  const captured = bounds ?? { x: 0, y: 0, width: session.doc.width, height: session.doc.height };
  const entry = captureScoped(session, captured, adjustmentById(id).label);
  runOp(id, params, curvePoints, session.doc, bounds, session.selection);
  return {
    ...session,
    history: pushHistoryEntry(session.history, entry),
    revision: session.revision + 1,
    dirtySinceApply: true,
    lastDirtyRect: captured,
  };
}

/**
 * The dialog's live preview: the document is never touched. Multi-layer
 * sessions preview the full composite with the adjusted active layer
 * substituted in, so what the dialog shows is what OK produces (ADR-245).
 */
export function computeAdjustPreview(
  session: EditorSession,
  id: AdjustmentId,
  params: Readonly<Record<string, number>>,
  curvePoints?: readonly CurvePoint[],
): RgbaBuffer {
  const clone = cloneRgbaBuffer(session.doc);
  runOp(id, params, curvePoints, clone, selectionRect(session), session.selection);
  if (session.layers.length === 1) return clone;
  const layers = session.layers.map((layer) =>
    layer.buffer === session.doc ? { ...layer, buffer: clone } : layer,
  );
  return compositeSession({ ...session, doc: clone, layers });
}
