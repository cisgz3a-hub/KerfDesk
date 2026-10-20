import { describe, expect, it } from 'vitest';
import {
  burnGridSharpen,
  createSharpenedRowSource,
  gridSharpen,
  sharpenLuma,
  SHARPEN_AMOUNT_MAX,
  SHARPEN_RADIUS_MAX,
  SHARPEN_RADIUS_MIN,
} from './luma-sharpen';

const W = 23;
const H = 17;

// Deterministic photo-like texture: smooth gradients plus a hard edge.
function texture(width = W, height = H): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const smooth = 128 + 70 * Math.sin(x / 3.1) * Math.cos(y / 2.3);
      out[y * width + x] = Math.round(x > width / 2 ? smooth * 0.5 : smooth);
    }
  }
  return out;
}

function rows(source: (y: number) => Uint8Array, order: readonly number[]): Uint8Array {
  const out = new Uint8Array(W * H);
  for (const y of order) out.set(source(y), y * W);
  return out;
}

const SHARPEN = gridSharpen({ amountPercent: 120, radiusCells: 1.4 });

describe('burnGridSharpen', () => {
  it('is off when absent, zero, non-finite or Pass-through', () => {
    expect(burnGridSharpen({}, false)).toBeNull();
    expect(burnGridSharpen({ sharpenRadius: 2 }, false)).toBeNull();
    expect(burnGridSharpen({ sharpenAmount: 0, sharpenRadius: 2 }, false)).toBeNull();
    expect(burnGridSharpen({ sharpenAmount: -5 }, false)).toBeNull();
    expect(burnGridSharpen({ sharpenAmount: Number.NaN }, false)).toBeNull();
    expect(burnGridSharpen({ sharpenAmount: 80 }, true)).toBeNull();
  });

  it('defaults the radius to one cell and keeps both values in range', () => {
    expect(burnGridSharpen({ sharpenAmount: 80 }, false)).toEqual({
      amountPercent: 80,
      radiusCells: 1,
    });
    expect(burnGridSharpen({ sharpenAmount: 9000, sharpenRadius: 99 }, false)).toEqual({
      amountPercent: SHARPEN_AMOUNT_MAX,
      radiusCells: SHARPEN_RADIUS_MAX,
    });
    expect(burnGridSharpen({ sharpenAmount: 50, sharpenRadius: 0.01 }, false)).toEqual({
      amountPercent: 50,
      radiusCells: SHARPEN_RADIUS_MIN,
    });
  });

  it('keeps the radius the same size in millimetres on a coarser grid', () => {
    const sharpen = { amountPercent: 100, radiusCells: 2 };
    expect(gridSharpen(sharpen, 4, 0.5)).toEqual({ amountPercent: 100, sigmaX: 0.5, sigmaY: 4 });
  });
});

describe('sharpenLuma', () => {
  it('leaves a flat field and a flat border unchanged', () => {
    const flat = new Uint8Array(W * H).fill(97);
    expect(Array.from(sharpenLuma(flat, W, H, SHARPEN))).toEqual(Array.from(flat));
  });

  it('pushes both sides of an edge apart and clamps to bytes', () => {
    const edge = new Uint8Array(W * H);
    for (let i = 0; i < edge.length; i += 1) edge[i] = i % W < 11 ? 40 : 220;
    const out = sharpenLuma(edge, W, H, gridSharpen({ amountPercent: 500, radiusCells: 1 }));
    const row = Array.from(out.subarray(5 * W, 6 * W));

    expect(row[10]).toBe(0);
    expect(row[11]).toBe(255);
    expect(row[0]).toBe(40);
    expect(row[W - 1]).toBe(220);
  });

  it('does not modify its input', () => {
    const input = texture();
    const copy = Uint8Array.from(input);
    sharpenLuma(input, W, H, SHARPEN);
    expect(Array.from(input)).toEqual(Array.from(copy));
  });
});

describe('createSharpenedRowSource', () => {
  it('streams the same bytes as the materialized pass in any row order', () => {
    const input = texture();
    const materialized = sharpenLuma(input, W, H, SHARPEN);
    const rowAt = (y: number): Uint8Array => input.slice(y * W, (y + 1) * W);
    const down = Array.from({ length: H }, (_, y) => y);
    const shuffled = down.map((y) => (y * 7) % H);

    for (const order of [down, [...down].reverse(), shuffled]) {
      const streamed = rows(createSharpenedRowSource(rowAt, W, H, SHARPEN), order);
      expect(Array.from(streamed)).toEqual(Array.from(materialized));
    }
  });

  it('reads each source row about once on a sequential walk', () => {
    const input = texture();
    let reads = 0;
    const source = createSharpenedRowSource(
      (y) => {
        reads += 1;
        return input.subarray(y * W, (y + 1) * W);
      },
      W,
      H,
      SHARPEN,
    );
    for (let y = H - 1; y >= 0; y -= 1) source(y);
    expect(reads).toBe(H);
  });
});
