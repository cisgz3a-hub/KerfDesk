// Layer session ops (ADR-245): keep the doc-pointer invariant — session.doc
// IS the active layer's buffer — through every Layers-panel action, and
// provide the single composite used by both the canvas and the Apply bake.

import {
  addLayerAbove,
  compositeLayersInPlace,
  duplicateLayer,
  layerFromBuffer,
  mergeDown,
  moveLayer,
  moveLayerTo,
  removeLayer,
  setLayerProps,
  type EditorLayer,
} from '../../core/image-layers';
import { createEditHistory, type EditHistory, type RgbaBuffer } from '../../core/image-edit';
import { redoSession, undoSession, type EditorSession } from './editor-session';

type LayerProps = Partial<Pick<EditorLayer, 'name' | 'isVisible' | 'opacity' | 'blend'>>;

// Re-derive the doc pointer after a list change. Each caller states its own
// history policy (V2 plan A2): entries carry a layer scope, so most
// structure ops KEEP history; only ops that replace buffer identities
// (merge) or drop a layer (purge) touch it.
function withLayers(
  session: EditorSession,
  layers: readonly EditorLayer[],
  activeLayerId: string,
  history: EditHistory,
  marksDirty: boolean,
): EditorSession {
  const active =
    layers.find((layer) => layer.id === activeLayerId) ??
    layers[layers.length - 1] ??
    session.layers[0];
  if (active === undefined) return session;
  return {
    ...session,
    doc: active.buffer,
    layers,
    activeLayerId: active.id,
    history,
    revision: session.revision + 1,
    dirtySinceApply: session.dirtySinceApply || marksDirty,
    // Layer-structure changes can move ink anywhere — full recomposite.
    lastDirtyRect: null,
  };
}

/** Drop every entry recorded against a removed layer. */
function purgeScope(history: EditHistory, scope: string): EditHistory {
  return {
    ...history,
    undoStack: history.undoStack.filter((entry) => entry.scope !== scope),
    redoStack: history.redoStack.filter((entry) => entry.scope !== scope),
  };
}

/** Make another layer the paint target — editor undo is kept (A2). */
export function setActiveLayer(session: EditorSession, id: string): EditorSession {
  if (id === session.activeLayerId) return session;
  return withLayers(session, session.layers, id, session.history, false);
}

// If the next history step belongs to another layer, follow it there first
// (pointer swap only — never touches the history itself).
function followScope(
  session: EditorSession,
  entry: EditHistory['undoStack'][number] | undefined,
): EditorSession {
  if (entry === undefined || entry.scope === '' || entry.scope === session.activeLayerId) {
    return session;
  }
  const target = session.layers.find((layer) => layer.id === entry.scope);
  if (target === undefined) return session;
  return {
    ...session,
    doc: target.buffer,
    activeLayerId: target.id,
    revision: session.revision + 1,
    lastDirtyRect: null,
  };
}

/** Undo that follows the entry's layer across switches (V2 plan A2). */
export function undoScoped(session: EditorSession): EditorSession {
  return undoSession(followScope(session, session.history.undoStack.at(-1)));
}

/** Redo that follows the entry's layer across switches (V2 plan A2). */
export function redoScoped(session: EditorSession): EditorSession {
  return redoSession(followScope(session, session.history.redoStack.at(-1)));
}

export function addLayerAboveActive(session: EditorSession, newId: string): EditorSession {
  const name = `Layer ${session.layers.length}`;
  const layers = addLayerAbove(session.layers, session.activeLayerId, newId, name);
  if (layers === session.layers) return session;
  return withLayers(session, layers, newId, session.history, true);
}

export function duplicateActiveLayer(session: EditorSession, newId: string): EditorSession {
  const layers = duplicateLayer(session.layers, session.activeLayerId, newId);
  if (layers === session.layers) return session;
  return withLayers(session, layers, newId, session.history, true);
}

/** Delete the active layer; activation falls to the layer below (or bottom). */
export function removeActiveLayer(session: EditorSession): EditorSession {
  const at = session.layers.findIndex((layer) => layer.id === session.activeLayerId);
  const layers = removeLayer(session.layers, session.activeLayerId);
  if (layers === session.layers) return session;
  const fallback = layers[Math.max(0, at - 1)] ?? layers[0];
  if (fallback === undefined) return session;
  // The removed layer's entries can never replay — purge exactly those.
  return withLayers(
    session,
    layers,
    fallback.id,
    purgeScope(session.history, session.activeLayerId),
    true,
  );
}

export function moveActiveLayer(session: EditorSession, direction: 1 | -1): EditorSession {
  const layers = moveLayer(session.layers, session.activeLayerId, direction);
  if (layers === session.layers) return session;
  return withLayers(session, layers, session.activeLayerId, session.history, true);
}

/**
 * Insert a pre-rendered doc-sized buffer (rasterized text, V2 plan C) as a
 * new layer above the active one, and activate it. The buffer must match the
 * document dimensions (ADR-245 uniform-dimension invariant).
 */
export function addTextLayer(
  session: EditorSession,
  newId: string,
  name: string,
  buffer: RgbaBuffer,
): EditorSession {
  if (buffer.width !== session.doc.width || buffer.height !== session.doc.height) return session;
  const layer = layerFromBuffer(newId, name, buffer);
  const at = session.layers.findIndex((candidate) => candidate.id === session.activeLayerId);
  const insertAt = at < 0 ? session.layers.length : at + 1;
  const layers = [...session.layers.slice(0, insertAt), layer, ...session.layers.slice(insertAt)];
  return withLayers(session, layers, newId, session.history, true);
}

/** Drag reorder: move ANY layer to an exact stack index (history kept). */
export function moveLayerToIndex(
  session: EditorSession,
  id: string,
  stackIndex: number,
): EditorSession {
  const layers = moveLayerTo(session.layers, id, stackIndex);
  if (layers === session.layers) return session;
  return withLayers(session, layers, session.activeLayerId, session.history, true);
}

/** Merge the active layer into the one below; the lower layer stays active. */
export function mergeActiveLayerDown(session: EditorSession): EditorSession {
  const at = session.layers.findIndex((layer) => layer.id === session.activeLayerId);
  const lower = session.layers[at - 1];
  if (lower === undefined) return session;
  const layers = mergeDown(session.layers, session.activeLayerId);
  if (layers === session.layers) return session;
  // Merge replaces the lower buffer's identity — its old tiles (and the
  // merged layer's) can no longer replay. Same rule as crop: clear.
  return withLayers(session, layers, lower.id, createEditHistory(), true);
}

export function setActiveLayerProps(session: EditorSession, props: LayerProps): EditorSession {
  return withLayers(
    session,
    setLayerProps(session.layers, session.activeLayerId, props),
    session.activeLayerId,
    session.history,
    true,
  );
}

/**
 * The one composite path (ADR-245): what the canvas shows and what Apply
 * bakes. Fast path: a single fully-visible normal layer IS the document.
 */
export function compositeSession(session: EditorSession): RgbaBuffer {
  const only = session.layers.length === 1 ? session.layers[0] : undefined;
  if (
    only !== undefined &&
    only.isVisible &&
    only.opacity === 1 &&
    only.blend === 'normal' &&
    only.buffer === session.doc
  ) {
    return session.doc;
  }
  const data = new Uint8ClampedArray(session.doc.width * session.doc.height * 4);
  data.fill(255);
  const target: RgbaBuffer = { width: session.doc.width, height: session.doc.height, data };
  compositeLayersInPlace(target, session.layers);
  return target;
}
