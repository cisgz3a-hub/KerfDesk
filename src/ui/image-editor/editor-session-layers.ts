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
import { pushHistoryEntry, type EditHistory, type RgbaBuffer } from '../../core/image-edit';
import { redoSession, undoSession, type EditorSession } from './editor-session';
import { compositeIdentity } from './editor-composite-identity';
import { captureDocumentHistory } from './editor-document-history';

type LayerProps = Partial<Pick<EditorLayer, 'name' | 'isVisible' | 'opacity' | 'blend'>>;

// Every document change records the complete preceding layer stack. Restoring
// its IDs and buffers makes earlier scoped pixel edits safe to replay again.
function withLayers(
  session: EditorSession,
  layers: readonly EditorLayer[],
  activeLayerId: string,
  label: string | null,
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
    history:
      label === null
        ? session.history
        : pushHistoryEntry(session.history, captureDocumentHistory(session, label)),
    revision: session.revision + 1,
    dirtySinceApply: session.dirtySinceApply || label !== null,
    // Layer-structure changes can move ink anywhere — full recomposite.
    lastDirtyRect: null,
  };
}

/** Make another layer the paint target — editor undo is kept (A2). */
export function setActiveLayer(session: EditorSession, id: string): EditorSession {
  if (id === session.activeLayerId || !session.layers.some((layer) => layer.id === id))
    return session;
  return withLayers(session, session.layers, id, null);
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
  if (session.layers.some((layer) => layer.id === newId)) return session;
  const name = `Layer ${session.layers.length}`;
  const layers = addLayerAbove(session.layers, session.activeLayerId, newId, name);
  if (layers === session.layers) return session;
  return withLayers(session, layers, newId, 'Add layer');
}

export function duplicateActiveLayer(session: EditorSession, newId: string): EditorSession {
  if (session.layers.some((layer) => layer.id === newId)) return session;
  const layers = duplicateLayer(session.layers, session.activeLayerId, newId);
  if (layers === session.layers) return session;
  return withLayers(session, layers, newId, 'Duplicate layer');
}

/** Delete the active layer; activation falls to the layer below (or bottom). */
export function removeActiveLayer(session: EditorSession): EditorSession {
  const at = session.layers.findIndex((layer) => layer.id === session.activeLayerId);
  const layers = removeLayer(session.layers, session.activeLayerId);
  if (layers === session.layers) return session;
  const fallback = layers[Math.max(0, at - 1)] ?? layers[0];
  if (fallback === undefined) return session;
  return withLayers(session, layers, fallback.id, 'Delete layer');
}

export function moveActiveLayer(session: EditorSession, direction: 1 | -1): EditorSession {
  const layers = moveLayer(session.layers, session.activeLayerId, direction);
  if (layers === session.layers) return session;
  return withLayers(session, layers, session.activeLayerId, 'Move layer');
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
  if (session.layers.some((layer) => layer.id === newId)) return session;
  const layer = layerFromBuffer(newId, name, buffer);
  const at = session.layers.findIndex((candidate) => candidate.id === session.activeLayerId);
  const insertAt = at < 0 ? session.layers.length : at + 1;
  const layers = [...session.layers.slice(0, insertAt), layer, ...session.layers.slice(insertAt)];
  return withLayers(session, layers, newId, 'Add text layer');
}

/** Drag reorder: move ANY layer to an exact stack index. */
export function moveLayerToIndex(
  session: EditorSession,
  id: string,
  stackIndex: number,
): EditorSession {
  const layers = moveLayerTo(session.layers, id, stackIndex);
  if (layers === session.layers) return session;
  return withLayers(session, layers, session.activeLayerId, 'Move layer');
}

/** Merge the active layer into the one below; the lower layer stays active. */
export function mergeActiveLayerDown(session: EditorSession): EditorSession {
  const at = session.layers.findIndex((layer) => layer.id === session.activeLayerId);
  const lower = session.layers[at - 1];
  if (lower === undefined) return session;
  const layers = mergeDown(session.layers, session.activeLayerId);
  if (layers === session.layers) return session;
  return withLayers(session, layers, lower.id, 'Merge layers');
}

export function setActiveLayerProps(session: EditorSession, props: LayerProps): EditorSession {
  const active = session.layers.find((layer) => layer.id === session.activeLayerId);
  if (
    active === undefined ||
    Object.entries(props).every(([key, value]) => active[key as keyof LayerProps] === value)
  )
    return session;
  const labels = {
    name: 'Rename layer',
    isVisible: 'Layer visibility',
    opacity: 'Layer opacity',
    blend: 'Layer blend',
  };
  const keys = Object.keys(props) as (keyof LayerProps)[];
  const first = keys[0];
  return withLayers(
    session,
    setLayerProps(session.layers, session.activeLayerId, props),
    session.activeLayerId,
    keys.length === 1 && first !== undefined ? labels[first] : 'Layer properties',
  );
}

/**
 * The one composite path (ADR-245): what the canvas shows and what Apply
 * bakes. Fast path: a single fully-visible normal layer IS the document.
 */
export function compositeSession(session: EditorSession): RgbaBuffer {
  const identity = compositeIdentity(session);
  if (identity !== null) return identity;
  const data = new Uint8ClampedArray(session.doc.width * session.doc.height * 4);
  data.fill(255);
  const target: RgbaBuffer = { width: session.doc.width, height: session.doc.height, data };
  compositeLayersInPlace(target, session.layers);
  return target;
}
