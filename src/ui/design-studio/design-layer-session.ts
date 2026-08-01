// design-layer-session — the pure session transitions behind the layers panel
// (ADR-272 Amendment 1). Layer edits are SKETCH edits — they ride the same
// history as geometry, so undo walks layer changes too — while the active
// layer is session state only. Total functions throughout: an edit that cannot
// apply returns the session unchanged (rule 7).

import {
  addDesignLayer,
  assignEntitiesToLayer,
  createDesignLayer,
  entityDesignLayer,
  moveDesignLayer,
  patchDesignLayer,
  removeDesignLayer,
  sketchLayers,
  type DesignLayerPatch,
} from '../../core/design/layers';
import { sessionSketch, withSketch, type DesignSession } from './design-session';

/**
 * Arms the layer the current selection sits on, so the settings panel edits
 * the layer the operator is actually looking at — clicking a shape shows its
 * cut, depth, and bit without hunting for the right row. Selecting also sets
 * where the NEXT shape lands, which is how Illustrator and Figma behave: there
 * is one "layer I am working in", not two.
 *
 * A selection spanning several layers names no single layer, so the active one
 * is left alone rather than guessing.
 */
export function armLayerOfSelection(session: DesignSession): DesignSession {
  if (session.selectedIds.size === 0) return session;
  const sketch = sessionSketch(session);
  const layers = sketchLayers(sketch);
  let layerId: string | null = null;
  for (const entity of sketch.entities) {
    if (!session.selectedIds.has(entity.id)) continue;
    const id = entityDesignLayer(entity, layers).id;
    if (layerId === null) layerId = id;
    else if (layerId !== id) return session;
  }
  if (layerId === null || layerId === session.activeLayerId) return session;
  return { ...session, activeLayerId: layerId };
}

export function setSessionActiveLayer(session: DesignSession, layerId: string): DesignSession {
  const layers = sketchLayers(sessionSketch(session));
  if (!layers.some((layer) => layer.id === layerId)) return session;
  if (session.activeLayerId === layerId) return session;
  return { ...session, activeLayerId: layerId };
}

// The new layer becomes active immediately: the reason an operator adds a
// layer is to draw on it next.
export function addSessionLayer(session: DesignSession, id: string): DesignSession {
  const sketch = sessionSketch(session);
  const layers = sketchLayers(sketch);
  const next = addDesignLayer(sketch, createDesignLayer(id, layers.length));
  if (next === sketch) return session;
  return { ...withSketch(session, next), activeLayerId: id };
}

export function patchSessionLayer(
  session: DesignSession,
  layerId: string,
  patch: DesignLayerPatch,
): DesignSession {
  return withSketch(session, patchDesignLayer(sessionSketch(session), layerId, patch));
}

export function removeSessionLayer(session: DesignSession, layerId: string): DesignSession {
  const sketch = sessionSketch(session);
  const next = removeDesignLayer(sketch, layerId);
  if (next === sketch) return session;
  const remaining = sketchLayers(next);
  const activeLayerId =
    session.activeLayerId === layerId
      ? (remaining[0]?.id ?? session.activeLayerId)
      : session.activeLayerId;
  return { ...withSketch(session, next), activeLayerId };
}

export function moveSessionLayer(
  session: DesignSession,
  layerId: string,
  direction: 'up' | 'down',
): DesignSession {
  return withSketch(session, moveDesignLayer(sessionSketch(session), layerId, direction));
}

// Assigning is meaningful only with a selection; an empty one is a no-op, and
// the panel's button says so in its title rather than hiding.
export function assignSelectionToSessionLayer(
  session: DesignSession,
  layerId: string,
): DesignSession {
  return withSketch(
    session,
    assignEntitiesToLayer(sessionSketch(session), session.selectedIds, layerId),
  );
}
