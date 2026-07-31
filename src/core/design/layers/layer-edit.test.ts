import { describe, expect, it } from 'vitest';

import type { Sketch, SketchEntity } from '../sketch-entity';
import { DEFAULT_DESIGN_LAYER, createDesignLayer } from './design-layer';
import {
  addDesignLayer,
  assignEntitiesToLayer,
  entityDesignLayer,
  moveDesignLayer,
  patchDesignLayer,
  removeDesignLayer,
  sketchLayers,
} from './layer-edit';

const line = (id: string, layerId?: string): SketchEntity => ({
  id,
  kind: 'line',
  start: { x: 0, y: 0 },
  end: { x: 10, y: 0 },
  ...(layerId === undefined ? {} : { layerId }),
});

const twoLayerSketch = (): Sketch => ({
  entities: [line('a'), line('b', 'design-layer-2')],
  layers: [DEFAULT_DESIGN_LAYER, createDesignLayer('design-layer-2', 1)],
});

describe('sketchLayers', () => {
  it('materializes the default layer for a pre-layer sketch', () => {
    expect(sketchLayers({ entities: [] })).toEqual([DEFAULT_DESIGN_LAYER]);
    expect(sketchLayers({ entities: [], layers: [] })).toEqual([DEFAULT_DESIGN_LAYER]);
  });
});

describe('entityDesignLayer', () => {
  it('falls back to the first layer for absent or unknown ids', () => {
    const layers = sketchLayers(twoLayerSketch());
    expect(entityDesignLayer(line('a'), layers)).toBe(layers[0]);
    expect(entityDesignLayer(line('a', 'missing'), layers)).toBe(layers[0]);
    expect(entityDesignLayer(line('a', 'design-layer-2'), layers).id).toBe('design-layer-2');
  });
});

describe('addDesignLayer', () => {
  it('appends and refuses duplicate ids without throwing', () => {
    const sketch: Sketch = { entities: [] };
    const added = addDesignLayer(sketch, createDesignLayer('design-layer-2', 1));
    expect(sketchLayers(added).map((layer) => layer.id)).toEqual([
      'design-layer-1',
      'design-layer-2',
    ]);
    expect(addDesignLayer(added, createDesignLayer('design-layer-2', 5))).toBe(added);
  });
});

describe('patchDesignLayer', () => {
  it('patches settings and ignores non-positive depths field-wise', () => {
    const sketch = twoLayerSketch();
    const patched = patchDesignLayer(sketch, 'design-layer-2', {
      cutType: 'pocket',
      depthMm: 6,
      toolId: 'em-3175',
    });
    const layer = sketchLayers(patched)[1];
    expect(layer?.cutType).toBe('pocket');
    expect(layer?.depthMm).toBe(6);
    expect(layer?.toolId).toBe('em-3175');
    const rejected = patchDesignLayer(patched, 'design-layer-2', { depthMm: Number.NaN });
    expect(sketchLayers(rejected)[1]?.depthMm).toBe(6);
    expect(patchDesignLayer(sketch, 'missing', { depthMm: 2 })).toBe(sketch);
  });
});

describe('removeDesignLayer', () => {
  it('re-homes entities to the first remaining layer and keeps the last layer', () => {
    const sketch = twoLayerSketch();
    const removed = removeDesignLayer(sketch, 'design-layer-2');
    expect(sketchLayers(removed)).toHaveLength(1);
    expect(removed.entities[1]?.layerId).toBe('design-layer-1');
    expect(removeDesignLayer(removed, 'design-layer-1')).toBe(removed);
  });
});

describe('moveDesignLayer', () => {
  it('swaps adjacent layers and holds at the ends', () => {
    const sketch = twoLayerSketch();
    const moved = moveDesignLayer(sketch, 'design-layer-2', 'up');
    expect(sketchLayers(moved).map((layer) => layer.id)).toEqual([
      'design-layer-2',
      'design-layer-1',
    ]);
    expect(moveDesignLayer(moved, 'design-layer-2', 'up')).toBe(moved);
  });
});

describe('assignEntitiesToLayer', () => {
  it('stamps listed entities and rejects unknown layers', () => {
    const sketch = twoLayerSketch();
    const assigned = assignEntitiesToLayer(sketch, new Set(['a']), 'design-layer-2');
    expect(assigned.entities[0]?.layerId).toBe('design-layer-2');
    expect(assigned.entities[1]?.layerId).toBe('design-layer-2');
    expect(assignEntitiesToLayer(sketch, new Set(['a']), 'missing')).toBe(sketch);
    expect(assignEntitiesToLayer(sketch, new Set(), 'design-layer-2')).toBe(sketch);
  });
});
