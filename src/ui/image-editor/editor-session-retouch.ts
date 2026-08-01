// Retouch session ops (ADR-246, V2 plan B2): clone stamp and spot heal.
// Clone snapshots the COMPOSITE at stroke commit (never its own output) and
// keeps the ALIGNED offset on the tool object across strokes; heal is a
// click-dab tool sized by the brush. One scoped history entry per action.

import { pushHistoryEntry, type PaintPoint } from '../../core/image-edit';
import {
  cloneStrokeDirtyRect,
  cloneStrokeInPlace,
  healDirtyRect,
  healSpotInPlace,
  type CloneStroke,
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
  cloneStrokeInPlace(
    session.doc,
    compositeSession(session),
    offset,
    stroke,
    session.selection ?? undefined,
  );
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
  const entry = captureScoped(session, rect, 'Spot heal');
  healSpotInPlace(session.doc, centre, radiusPx, session.selection ?? undefined);
  return {
    ...session,
    history: pushHistoryEntry(session.history, entry),
    revision: session.revision + 1,
    dirtySinceApply: true,
    lastDirtyRect: rect,
  };
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
