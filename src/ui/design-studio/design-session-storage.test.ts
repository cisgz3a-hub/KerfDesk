import { afterEach, describe, expect, it } from 'vitest';

import type { Sketch } from '../../core/design';
import { DEFAULT_DESIGN_LAYER } from '../../core/design/layers';
import { createDesignSession, restoreDesignSession, sessionSketch } from './design-session';
import {
  clearPersistedSession,
  readPersistedSession,
  writePersistedSession,
} from './design-session-storage';

const STORAGE_KEY = 'laserforge.design-studio-session.v1';

const sketch: Sketch = {
  entities: [
    {
      id: 'r',
      kind: 'rect',
      origin: { x: 10, y: 20 },
      widthMm: 40,
      heightMm: 30,
      cornerRadiusMm: 2,
      layerId: DEFAULT_DESIGN_LAYER.id,
    },
  ],
  layers: [DEFAULT_DESIGN_LAYER],
};

const applied = {
  objectIds: new Set(['obj-1', 'obj-2']),
  operationIdByLayerId: new Map([[DEFAULT_DESIGN_LAYER.id, 'operation-7']]),
};

afterEach(() => clearPersistedSession());

describe('persisting the drawing', () => {
  it('round-trips the sketch, the armed layer, the surface, and the apply record', () => {
    writePersistedSession({
      sketch,
      activeLayerId: DEFAULT_DESIGN_LAYER.id,
      surface3d: false,
      applied,
    });
    const restored = readPersistedSession();
    expect(restored?.sketch.entities).toHaveLength(1);
    expect(restored?.activeLayerId).toBe(DEFAULT_DESIGN_LAYER.id);
    expect(restored?.surface3d).toBe(false);
    expect([...(restored?.applied?.objectIds ?? [])]).toEqual(['obj-1', 'obj-2']);
    expect(restored?.applied?.operationIdByLayerId.get(DEFAULT_DESIGN_LAYER.id)).toBe(
      'operation-7',
    );
  });

  it('reads nothing when there is nothing saved', () => {
    expect(readPersistedSession()).toBeNull();
  });

  // Untrusted input: a hand-edited or half-written payload must read as "no
  // saved drawing", never throw into the open path.
  it('survives a corrupt or foreign payload', () => {
    localStorage.setItem(STORAGE_KEY, 'not json at all');
    expect(readPersistedSession()).toBeNull();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 99, sketch }));
    expect(readPersistedSession()).toBeNull();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, sketch: { entities: 'no' } }));
    expect(readPersistedSession()).toBeNull();
  });

  it('keeps a sketch that has no apply record yet', () => {
    writePersistedSession({
      sketch,
      activeLayerId: DEFAULT_DESIGN_LAYER.id,
      surface3d: true,
      applied: null,
    });
    const restored = readPersistedSession();
    expect(restored?.applied).toBeNull();
    expect(restored?.surface3d).toBe(true);
  });
});

describe('restoring a session from the saved drawing', () => {
  it('brings the geometry back with a fresh history', () => {
    const restored = restoreDesignSession({
      sketch,
      activeLayerId: DEFAULT_DESIGN_LAYER.id,
      surface3d: true,
      applied,
    });
    expect(sessionSketch(restored).entities).toHaveLength(1);
    // History does not outlive the tab: undoing into a project state that no
    // longer exists would be worse than losing the undo depth.
    expect(restored.history.past).toHaveLength(0);
    expect(restored.dirtySinceApply).toBe(false);
  });

  // The whole point of carrying the record across a reload: the next Apply
  // updates the artwork rather than duplicating it.
  it('carries the apply record, so the next Apply still replaces', () => {
    const restored = restoreDesignSession({
      sketch,
      activeLayerId: DEFAULT_DESIGN_LAYER.id,
      surface3d: true,
      applied,
    });
    expect(restored.applied?.objectIds.has('obj-1')).toBe(true);
  });

  it('falls back to a real layer when the armed one is gone', () => {
    const restored = restoreDesignSession({
      sketch,
      activeLayerId: 'a-layer-that-was-deleted',
      surface3d: true,
      applied: null,
    });
    expect(restored.activeLayerId).toBe(DEFAULT_DESIGN_LAYER.id);
  });

  it('starts from a blank session shape otherwise', () => {
    const restored = restoreDesignSession({
      sketch,
      activeLayerId: DEFAULT_DESIGN_LAYER.id,
      surface3d: true,
      applied: null,
    });
    const blank = createDesignSession();
    expect(restored.tool).toBe(blank.tool);
    expect(restored.selectedIds.size).toBe(0);
    expect(restored.move).toBeNull();
    expect(restored.resize).toBeNull();
  });
});
