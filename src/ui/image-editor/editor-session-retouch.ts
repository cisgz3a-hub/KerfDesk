// Retouch session ops (ADR-246, V2 plan B2): clone stamp and spot heal.
// Clone snapshots the COMPOSITE at stroke commit (never its own output) and
// keeps the ALIGNED offset on the tool object across strokes; heal is a
// click-dab tool sized by the brush. One scoped history entry per action.

import { cloneRgbaBuffer, pushHistoryEntry, type PaintPoint } from '../../core/image-edit';
import {
  cloneStrokeDirtyRect,
  cloneStrokeInPlace,
  healDirtyRect,
  healRepairFrom,
  healSpotInPlace,
  type CloneStroke,
  type HealRepair,
} from '../../core/image-retouch';
import { captureScoped, type EditorSession } from './editor-session';
import { compositeSession } from './editor-session-layers';
import { useImageEditorStore } from './image-editor-store';

export function commitCloneStroke(
  session: EditorSession,
  offset: PaintPoint,
  stroke: CloneStroke,
): EditorSession {
  const rect = cloneStrokeDirtyRect(stroke, session.doc);
  if (rect.width === 0 || rect.height === 0) return session;
  const entry = captureScoped(session, rect, 'Clone stamp');
  const composite = compositeSession(session);
  // The single opaque-layer fast path aliases doc; all dabs must read the
  // pre-stroke pixels. Multilayer composites already own a separate buffer.
  const source =
    composite.data.buffer === session.doc.data.buffer ? cloneRgbaBuffer(composite) : composite;
  cloneStrokeInPlace(session.doc, source, offset, stroke, session.selection ?? undefined);
  return {
    ...session,
    history: pushHistoryEntry(session.history, entry),
    revision: session.revision + 1,
    dirtySinceApply: true,
    lastDirtyRect: rect,
  };
}

export function commitHealDab(
  session: EditorSession,
  centre: PaintPoint,
  radiusPx: number,
): EditorSession {
  const rect = healDirtyRect(session.doc, centre, radiusPx);
  if (rect.width === 0 || rect.height === 0) return session;
  const repair = healRepairFor(session, centre, radiusPx);
  if (repair === null) return session;
  const entry = captureScoped(session, rect, 'Spot heal');
  healSpotInPlace(session.doc, centre, radiusPx, session.selection ?? undefined, repair);
  return {
    ...session,
    history: pushHistoryEntry(session.history, entry),
    revision: session.revision + 1,
    dirtySinceApply: true,
    lastDirtyRect: rect,
  };
}

// Heal patches the active layer from its own ring, alpha-weighted, so a
// transparent surround heals to transparency instead of the black RGB that
// transparent pixels hold (audit 23-P2-1). An upper layer that is empty around
// the spot has nothing of its own to heal from, so it heals from the visible
// composite, as clone samples it: the heal-on-a-new-layer habit.
function healRepairFor(
  session: EditorSession,
  centre: PaintPoint,
  radiusPx: number,
): HealRepair | null {
  const own = healRepairFrom(session.doc, centre, radiusPx);
  const isBottomLayer = session.layers[0]?.id === session.activeLayerId;
  if (own === null || own.alpha > 0 || isBottomLayer) return own;
  return healRepairFrom(compositeSession(session), centre, radiusPx);
}

/**
 * Pointer completion for a clone stroke. Aligned offset: the first stroke
 * after Alt-click fixes source − firstPoint and it persists on the tool
 * until a new source is set.
 */
export function applyCloneStroke(points: readonly PaintPoint[]): void {
  const store = useImageEditorStore.getState();
  const { session, tool, brush } = store;
  const first = points[0];
  if (session === null || tool.kind !== 'clone' || tool.source === null || first === undefined) {
    return;
  }
  const offset = tool.offset ?? {
    x: tool.source.x - first.x,
    y: tool.source.y - first.y,
  };
  if (tool.offset === null) {
    store.setTool({ kind: 'clone', source: tool.source, offset });
  }
  useImageEditorStore.setState({
    session: commitCloneStroke(session, offset, {
      points,
      diameterPx: brush.diameterPx,
      hardness: brush.hardness,
      opacity: brush.opacity,
    }),
  });
}

/** Pointer entry for a heal click-dab, sized by the brush diameter. */
export function applyHealAt(x: number, y: number): void {
  const store = useImageEditorStore.getState();
  if (store.session === null) return;
  useImageEditorStore.setState({
    session: commitHealDab(store.session, { x, y }, store.brush.diameterPx / 2),
  });
}
