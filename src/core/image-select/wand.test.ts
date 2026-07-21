import { describe, expect, it } from 'vitest';
import { createRgbaBuffer, RGBA_CHANNELS } from '../image-edit/rgba-buffer';
import { wandSelection } from './wand';

function setPixel(
  buffer: ReturnType<typeof createRgbaBuffer>,
  x: number,
  y: number,
  value: number,
): void {
  const base = (y * buffer.width + x) * RGBA_CHANNELS;
  buffer.data[base] = value;
  buffer.data[base + 1] = value;
  buffer.data[base + 2] = value;
}

function count(alpha: Uint8Array): number {
  let selected = 0;
  for (const value of alpha) if (value > 0) selected += 1;
  return selected;
}

// White 6x6 with two disjoint black bars: columns 0-1 and columns 4-5.
function twoBarsBuffer() {
  const buffer = createRgbaBuffer(6, 6);
  for (let y = 0; y < 6; y += 1) {
    for (const x of [0, 1, 4, 5]) setPixel(buffer, x, y, 0);
  }
  return buffer;
}

describe('wandSelection', () => {
  it('contiguous mode selects only the seed-connected region', () => {
    const mask = wandSelection(twoBarsBuffer(), 0, 0, { tolerance: 0, contiguous: true });
    expect(count(mask.alpha)).toBe(12);
    expect(mask.alpha[4]).toBe(0);
  });

  it('global mode selects every matching pixel in the document', () => {
    const mask = wandSelection(twoBarsBuffer(), 0, 0, { tolerance: 0, contiguous: false });
    expect(count(mask.alpha)).toBe(24);
  });

  it('tolerance is a per-channel band around the seed colour', () => {
    const buffer = createRgbaBuffer(4, 1);
    setPixel(buffer, 0, 0, 0);
    setPixel(buffer, 1, 0, 100);
    const tight = wandSelection(buffer, 0, 0, { tolerance: 99, contiguous: true });
    expect(count(tight.alpha)).toBe(1);
    const wide = wandSelection(buffer, 0, 0, { tolerance: 100, contiguous: true });
    expect(count(wide.alpha)).toBe(2);
  });

  it('a wand click on a uniform image selects everything', () => {
    const mask = wandSelection(createRgbaBuffer(5, 5), 2, 2, { tolerance: 0, contiguous: true });
    expect(count(mask.alpha)).toBe(25);
  });

  it('an out-of-document seed selects nothing', () => {
    const mask = wandSelection(createRgbaBuffer(4, 4), 9, 1, { tolerance: 0, contiguous: true });
    expect(count(mask.alpha)).toBe(0);
  });
});
