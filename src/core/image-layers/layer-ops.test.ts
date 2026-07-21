import { describe, expect, it } from 'vitest';
import {
  addLayerAbove,
  duplicateLayer,
  mergeDown,
  moveLayer,
  removeLayer,
  setLayerProps,
} from './layer-ops';
import { createLayer } from './layer';

function stack() {
  return [
    createLayer('bg', 'Background', 4, 4, 'white'),
    createLayer('l1', 'Layer 1', 4, 4, 'transparent'),
  ];
}

describe('layer list ops', () => {
  it('addLayerAbove inserts directly above the reference layer', () => {
    const layers = addLayerAbove(stack(), 'bg', 'new', 'Layer 2');
    expect(layers.map((l) => l.id)).toEqual(['bg', 'new', 'l1']);
    expect(layers[1]?.buffer.data[3]).toBe(0); // transparent
  });

  it('duplicateLayer copies pixels into an independent buffer', () => {
    const layers = stack();
    const source = layers[1];
    if (source !== undefined) source.buffer.data[0] = 42;
    const next = duplicateLayer(layers, 'l1', 'copy');
    expect(next.map((l) => l.id)).toEqual(['bg', 'l1', 'copy']);
    expect(next[2]?.buffer.data[0]).toBe(42);
    if (source !== undefined) source.buffer.data[0] = 7;
    expect(next[2]?.buffer.data[0]).toBe(42); // no byte sharing
  });

  it('removeLayer keeps at least one layer', () => {
    const one = [createLayer('bg', 'Background', 2, 2, 'white')];
    expect(removeLayer(one, 'bg')).toBe(one);
    expect(removeLayer(stack(), 'l1').map((l) => l.id)).toEqual(['bg']);
  });

  it('moveLayer swaps neighbours and clamps at the ends', () => {
    const layers = stack();
    expect(moveLayer(layers, 'bg', 1).map((l) => l.id)).toEqual(['l1', 'bg']);
    expect(moveLayer(layers, 'l1', 1)).toBe(layers); // already on top
  });

  it('mergeDown composites into the lower layer and keeps its identity', () => {
    const layers = stack();
    const upper = layers[1];
    if (upper !== undefined) {
      upper.buffer.data[0] = 0;
      upper.buffer.data[1] = 0;
      upper.buffer.data[2] = 0;
      upper.buffer.data[3] = 255;
    }
    const merged = mergeDown(layers, 'l1');
    expect(merged.map((l) => l.id)).toEqual(['bg']);
    expect(merged[0]?.buffer.data[0]).toBe(0); // ink landed
    expect(merged[0]?.buffer.data[1 * 4 + 0]).toBe(255); // rest still white
  });

  it('setLayerProps edits one layer immutably', () => {
    const layers = stack();
    const next = setLayerProps(layers, 'l1', { isVisible: false, opacity: 0.4 });
    expect(next[1]?.isVisible).toBe(false);
    expect(next[1]?.opacity).toBe(0.4);
    expect(layers[1]?.isVisible).toBe(true);
  });
});
