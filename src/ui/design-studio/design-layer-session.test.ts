import { describe, expect, it } from 'vitest';

import { DEFAULT_DESIGN_LAYER_ID, sketchLayers } from '../../core/design/layers';
import {
  addSessionLayer,
  assignSelectionToSessionLayer,
  patchSessionLayer,
  removeSessionLayer,
  setSessionActiveLayer,
} from './design-layer-session';
import { createDesignSession, sessionSketch, withSketch } from './design-session';

const sessionWithRect = () => {
  const base = createDesignSession();
  return withSketch(base, {
    entities: [
      {
        id: 'r1',
        kind: 'rect',
        origin: { x: 0, y: 0 },
        widthMm: 10,
        heightMm: 10,
        cornerRadiusMm: 0,
      },
    ],
  });
};

describe('design-layer-session', () => {
  it('adding a layer makes it active and one undo step', () => {
    const session = addSessionLayer(sessionWithRect(), 'layer-b');
    expect(session.activeLayerId).toBe('layer-b');
    expect(sketchLayers(sessionSketch(session)).map((layer) => layer.id)).toEqual([
      DEFAULT_DESIGN_LAYER_ID,
      'layer-b',
    ]);
    expect(session.history.past.length).toBeGreaterThan(0);
  });

  it('removing the active layer falls back to the first remaining layer', () => {
    const twoLayers = addSessionLayer(sessionWithRect(), 'layer-b');
    const removed = removeSessionLayer(twoLayers, 'layer-b');
    expect(removed.activeLayerId).toBe(DEFAULT_DESIGN_LAYER_ID);
    expect(sketchLayers(sessionSketch(removed))).toHaveLength(1);
  });

  it('activating an unknown layer is a no-op, not an error', () => {
    const session = sessionWithRect();
    expect(setSessionActiveLayer(session, 'missing')).toBe(session);
  });

  it('assigning the selection stamps entities onto the layer', () => {
    const twoLayers = addSessionLayer(sessionWithRect(), 'layer-b');
    const selected = { ...twoLayers, selectedIds: new Set(['r1']) };
    const assigned = assignSelectionToSessionLayer(selected, 'layer-b');
    expect(sessionSketch(assigned).entities[0]?.layerId).toBe('layer-b');
  });

  it('patching a bit with null clears it back to the machine bit', () => {
    const session = patchSessionLayer(sessionWithRect(), DEFAULT_DESIGN_LAYER_ID, {
      toolId: 'em-3175',
    });
    const patched = sketchLayers(sessionSketch(session))[0];
    expect(patched?.toolId).toBe('em-3175');
    const cleared = patchSessionLayer(session, DEFAULT_DESIGN_LAYER_ID, { toolId: null });
    expect(sketchLayers(sessionSketch(cleared))[0]?.toolId).toBeUndefined();
  });
});
