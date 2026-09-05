import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../image-edit/rgba-buffer';
import { compositeLayersInPlace } from './composite';
import { createLayer, type EditorLayer, type LayerBlend } from './layer';
import { mergeDown } from './layer-ops';

function layer(
  id: string,
  rgba: readonly number[],
  opacity = 1,
  blend: LayerBlend = 'normal',
): EditorLayer {
  const result = createLayer(id, id, 1, 1, 'transparent');
  result.buffer.data.set(rgba);
  return { ...result, opacity, blend };
}

function visible(layers: readonly EditorLayer[]) {
  const doc = createRgbaBuffer(1, 1);
  compositeLayersInPlace(doc, layers);
  return [...doc.data];
}

function expectAppearance(before: readonly EditorLayer[], after: readonly EditorLayer[]) {
  const expected = visible(before);
  visible(after).forEach((byte, index) =>
    expect(Math.abs(byte - (expected[index] ?? 0))).toBeLessThanOrEqual(1),
  );
}

describe('Merge Down appearance', () => {
  it('quantizes a normal merge only once, retaining its backdrop-independent RGBA', () => {
    const backdrop = layer('bg', [147, 12, 224, 255]);
    const lower = layer('lower', [103, 238, 56, 247], 0.9105941683519632);
    const upper = layer('upper', [209, 144, 175, 193], 0.24651890504173934);
    const merged = mergeDown([backdrop, lower, upper], 'upper');
    expect(Array.from(merged[1]?.buffer.data ?? [])).toEqual([125, 219, 81, 231]);
    expect(visible([backdrop, lower, upper])).toEqual([127, 198, 94, 255]);
    // Two separately rounded visible layers need not equal one RGBA8 layer.
    // This rare fixture has a two-byte difference, not the former darkening.
    expect(visible(merged)).toEqual([127, 200, 94, 255]);
    expect(Array.from(mergeDown([lower, upper], 'upper')[0]?.buffer.data ?? [])).toEqual([
      125, 219, 81, 231,
    ]);
  });
  it('retains transparency and normal blend appearance across alternate backdrops', () => {
    const lower = layer('lower', [0, 0, 0, 0]);
    const upper = layer('upper', [255, 0, 0, 255], 0.5);
    const merged = mergeDown([lower, upper], 'upper');
    expect(merged[0]?.buffer.data[3]).toBe(128);
    expect(merged[0]?.buffer.data[0]).toBe(255);
    for (const rgba of [
      [255, 255, 255, 255],
      [0, 0, 255, 255],
      [23, 91, 37, 255],
    ]) {
      const backdrop = layer('bg', rgba);
      expectAppearance([backdrop, lower, upper], [backdrop, ...merged]);
    }
  });

  it.each(['normal', 'multiply', 'screen', 'overlay', 'difference'] as const)(
    'preserves visible %s blend with partial layer/pixel opacity and hidden layers',
    (blend) => {
      for (const backdrop of [
        [255, 255, 255, 255],
        [0, 0, 0, 255],
        [23, 91, 207, 255],
      ]) {
        for (const hidden of ['none', 'lower', 'upper']) {
          const lower = {
            ...layer('lower', [231, 44, 11, 128], 0.4, blend),
            isVisible: hidden !== 'lower',
          };
          const upper = {
            ...layer('upper', [15, 187, 99, 192], 0.7, blend),
            isVisible: hidden !== 'upper',
          };
          const layers = [layer('bg', backdrop), lower, upper];
          const merged = mergeDown(layers, 'upper');
          expect(merged.map((x) => x.id)).toEqual(['bg', 'lower']);
          expect(merged[1]?.opacity).toBe(1);
          expect(merged[1]?.blend).toBe('normal');
          expectAppearance(layers, merged);
        }
      }
    },
  );
});
