// Layer session ops (ADR-245): keep the doc-pointer invariant — session.doc
// IS the active layer's buffer — through every Layers-panel action, and
// provide the single composite used by both the canvas and the Apply bake.

import {
  addLayerAbove,
  compositeLayersInPlace,
  duplicateLayer,
  mergeDown,
  moveLayer,
  removeLayer,
  setLayerProps,
  type EditorLayer,
} from '../../core/image-layers';
import { createEditHistory, type RgbaBuffer } from '../../core/image-edit';
import type { EditorSession } from './editor-session';

type LayerProps = Partial<Pick<EditorLayer, 'name' | 'isVisible' | 'opacity' | 'blend'>>;

// Re-derive the doc pointer after a list change. A changed active buffer
// identity clears the tile history (entries are buffer-relative — the same
// rule as crop); pure property edits keep it.
function withLayers(
  session: EditorSession,
  layers: readonly EditorLayer[],
  activeLayerId: string,
): EditorSession {
  const active =
    layers.find((layer) => layer.id === activeLayerId) ??
    layers[layers.length - 1] ??
    session.layers[0];
  if (active === undefined) return session;
  const pointerChanged = active.buffer !== session.doc;
  return {
    ...session,
    doc: active.buffer,
    layers,
    activeLayerId: active.id,
    history: pointerChanged ? createEditHistory() : session.history,
    revision: session.revision + 1,
    dirtySinceApply: session.dirtySinceApply || pointerChanged,
  };
}

/** Make another layer the paint target (clears editor undo — stated in UI). */
export function setActiveLayer(session: EditorSession, id: string): EditorSession {
  if (id === session.activeLayerId) return session;
  return withLayers(session, session.layers, id);
}

export function addLayerAboveActive(session: EditorSession, newId: string): EditorSession {
  const name = `Layer ${session.layers.length}`;
  const layers = addLayerAbove(session.layers, session.activeLayerId, newId, name);
  if (layers === session.layers) return session;
  return withLayers(session, layers, newId);
}

export function duplicateActiveLayer(session: EditorSession, newId: string): EditorSession {
  const layers = duplicateLayer(session.layers, session.activeLayerId, newId);
  if (layers === session.layers) return session;
  return withLayers(session, layers, newId);
}

/** Delete the active layer; activation falls to the layer below (or bottom). */
export function removeActiveLayer(session: EditorSession): EditorSession {
  const at = session.layers.findIndex((layer) => layer.id === session.activeLayerId);
  const layers = removeLayer(session.layers, session.activeLayerId);
  if (layers === session.layers) return session;
  const fallback = layers[Math.max(0, at - 1)] ?? layers[0];
  if (fallback === undefined) return session;
  return withLayers(session, layers, fallback.id);
}

export function moveActiveLayer(session: EditorSession, direction: 1 | -1): EditorSession {
  const layers = moveLayer(session.layers, session.activeLayerId, direction);
  if (layers === session.layers) return session;
  return withLayers(session, layers, session.activeLayerId);
}

/** Merge the active layer into the one below; the lower layer stays active. */
export function mergeActiveLayerDown(session: EditorSession): EditorSession {
  const at = session.layers.findIndex((layer) => layer.id === session.activeLayerId);
  const lower = session.layers[at - 1];
  if (lower === undefined) return session;
  const layers = mergeDown(session.layers, session.activeLayerId);
  if (layers === session.layers) return session;
  return withLayers(session, layers, lower.id);
}

export function setActiveLayerProps(session: EditorSession, props: LayerProps): EditorSession {
  return withLayers(
    session,
    setLayerProps(session.layers, session.activeLayerId, props),
    session.activeLayerId,
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
