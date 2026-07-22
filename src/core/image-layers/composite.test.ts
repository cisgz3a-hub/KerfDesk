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

  it('a windowed composite matches the full composite inside the window', () => {
    const background = createLayer('bg', 'Background', 16, 16, 'white');
    const upper = createLayer('l1', 'Layer 1', 16, 16, 'transparent');
    for (const [x, y, g] of [
      [3, 3, 0],
      [8, 5, 90],
      [12, 12, 200],
    ] as const) {
      paint(upper, x, y, g);
    }
    const layers = [background, { ...upper, opacity: 0.7, blend: 'multiply' as const }];
    const full = createRgbaBuffer(16, 16);
    compositeLayersInPlace(full, layers);
    const windowed = createRgbaBuffer(16, 16);
    compositeLayersInPlace(windowed, layers, { x: 2, y: 2, width: 12, height: 12 });
    for (let y = 2; y < 14; y += 1) {
      for (let x = 2; x < 14; x += 1) {
        expect(grey(windowed, x, y)).toBe(grey(full, x, y));
      }
    }
    // Outside the window the target is untouched (still white).
    expect(grey(windowed, 0, 0)).toBe(255);
  });

  it('screen lightens, overlay splits at mid-grey, difference is |d - s|', () => {
    const cases: readonly {
      blend: 'screen' | 'overlay' | 'difference';
      dst: number;
      src: number;
      expected: number;
    }[] = [
      { blend: 'screen', dst: 128, src: 128, expected: 192 }, // 255-(127*127)/255
      { blend: 'screen', dst: 0, src: 0, expected: 0 },
      { blend: 'overlay', dst: 64, src: 128, expected: 64 }, // 2*64*128/255
      { blend: 'overlay', dst: 192, src: 128, expected: 192 }, // 255-2*63*127/255
      { blend: 'difference', dst: 200, src: 60, expected: 140 },
      { blend: 'difference', dst: 60, src: 200, expected: 140 },
    ];
    for (const { blend, dst, src, expected } of cases) {
      const bg = createRgbaBuffer(1, 1);
      bg.data[0] = dst;
      bg.data[1] = dst;
      bg.data[2] = dst;
      const background = layerFromBuffer('bg', 'Background', bg);
      let upper = createLayer('l1', 'Layer 1', 1, 1, 'transparent');
      paint(upper, 0, 0, src);
      upper = { ...upper, blend };
      const target = createRgbaBuffer(1, 1);
      compositeLayersInPlace(target, [background, upper]);
      expect(grey(target, 0, 0), `${blend} ${dst}/${src}`).toBeGreaterThanOrEqual(expected - 1);
      expect(grey(target, 0, 0), `${blend} ${dst}/${src}`).toBeLessThanOrEqual(expected + 1);
    }
  });

  it('a window fully outside the target is a no-op', () => {
    const target = createRgbaBuffer(8, 8);
    const layer = createLayer('l1', 'Layer 1', 8, 8, 'transparent');
    paint(layer, 1, 1, 0);
    compositeLayersInPlace(target, [layer], { x: 20, y: 20, width: 5, height: 5 });
    expect(grey(target, 1, 1)).toBe(255);
  });
});
