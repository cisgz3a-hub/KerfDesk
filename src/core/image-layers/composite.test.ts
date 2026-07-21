import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../image-edit/rgba-buffer';
import { compositeLayersInPlace } from './composite';
import { createLayer, layerFromBuffer } from './layer';

function paint(layer: ReturnType<typeof createLayer>, x: number, y: number, grey: number): void {
  const base = (y * layer.buffer.width + x) * 4;
  layer.buffer.data[base] = grey;
  layer.buffer.data[base + 1] = grey;
  layer.buffer.data[base + 2] = grey;
  layer.buffer.data[base + 3] = 255;
}

function grey(target: ReturnType<typeof createRgbaBuffer>, x: number, y: number): number {
  return target.data[(y * target.width + x) * 4] ?? -1;
}

describe('compositeLayersInPlace', () => {
  it('a transparent upper layer leaves the background untouched', () => {
    const target = createRgbaBuffer(4, 4);
    const background = createLayer('bg', 'Background', 4, 4, 'white');
    const upper = createLayer('l1', 'Layer 1', 4, 4, 'transparent');
    compositeLayersInPlace(target, [background, upper]);
    expect(grey(target, 1, 1)).toBe(255);
  });

  it('painted ink on an upper layer covers the background (normal)', () => {
    const target = createRgbaBuffer(4, 4);
    const background = createLayer('bg', 'Background', 4, 4, 'white');
    const upper = createLayer('l1', 'Layer 1', 4, 4, 'transparent');
    paint(upper, 2, 2, 0);
    compositeLayersInPlace(target, [background, upper]);
    expect(grey(target, 2, 2)).toBe(0);
    expect(grey(target, 0, 0)).toBe(255);
  });

  it('opacity lerps toward the ink', () => {
    const target = createRgbaBuffer(2, 1);
    const background = createLayer('bg', 'Background', 2, 1, 'white');
    let upper = createLayer('l1', 'Layer 1', 2, 1, 'transparent');
    paint(upper, 0, 0, 0);
    upper = { ...upper, opacity: 0.5 };
    compositeLayersInPlace(target, [background, upper]);
    expect(grey(target, 0, 0)).toBe(128);
  });

  it('multiply darkens: grey over grey', () => {
    const bg = createRgbaBuffer(1, 1);
    bg.data[0] = 128;
    bg.data[1] = 128;
    bg.data[2] = 128;
    const background = layerFromBuffer('bg', 'Background', bg);
    let upper = createLayer('l1', 'Layer 1', 1, 1, 'transparent');
    paint(upper, 0, 0, 128);
    upper = { ...upper, blend: 'multiply' };
    const target = createRgbaBuffer(1, 1);
    compositeLayersInPlace(target, [background, upper]);
    expect(grey(target, 0, 0)).toBe(64); // 128 * 128 / 255
  });

  it('hidden layers and dimension mismatches are skipped', () => {
    const target = createRgbaBuffer(4, 4);
    let hidden = createLayer('l1', 'Layer 1', 4, 4, 'transparent');
    paint(hidden, 0, 0, 0);
    hidden = { ...hidden, isVisible: false };
    const wrongSize = createLayer('l2', 'Layer 2', 2, 2, 'white');
    compositeLayersInPlace(target, [hidden, wrongSize]);
    expect(grey(target, 0, 0)).toBe(255);
  });

  it('the composite stays fully opaque', () => {
    const target = createRgbaBuffer(2, 2);
    compositeLayersInPlace(target, [createLayer('bg', 'Background', 2, 2, 'white')]);
    expect(target.data[3]).toBe(255);
  });
});
