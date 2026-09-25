import { describe, expect, it } from 'vitest';
import { flattenUnevenBackground, otsuBinarization } from './background-flatten';
import { otsuSeparation, otsuThreshold } from './preprocess';
import type { RawImageData } from './trace-image';

const W = 400;
const H = 200;
const INK_LUMA = 60;

// A 200×5 bar, a 5×90 bar and a 20×20 square (true ink area 1,850 px²).
function isInk(x: number, y: number): boolean {
  if (x >= 20 && x < 220 && y >= 10 && y < 15) return true;
  if (x >= 30 && x < 35 && y >= 40 && y < 130) return true;
  return x >= 200 && x < 220 && y >= 100 && y < 120;
}

function paintedImage(background: (x: number, y: number) => number): RawImageData {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const v = isInk(x, y) ? INK_LUMA : background(x, y);
      const o = (y * W + x) * 4;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  return { width: W, height: H, data };
}

const ramp = (x: number): number => Math.round(150 + (100 * x) / (W - 1));

function inkClassification(image: RawImageData, threshold: number): { fp: number; fn: number } {
  let fp = 0;
  let fn = 0;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const ink = (image.data[(y * W + x) * 4] ?? 255) < threshold;
      if (ink && !isInk(x, y)) fp += 1;
      if (!ink && isInk(x, y)) fn += 1;
    }
  }
  return { fp, fn };
}

describe('otsuSeparation', () => {
  it('reports the same cut as otsuThreshold and a separability in [0, 1]', () => {
    const image = paintedImage(ramp);
    const result = otsuSeparation(image);
    expect(result.threshold).toBe(otsuThreshold(image));
    expect(result.separability).toBeGreaterThan(0);
    expect(result.separability).toBeLessThanOrEqual(1);
  });

  it('reads a clean two-level page as almost perfectly separable', () => {
    expect(otsuSeparation(paintedImage(() => 240)).separability).toBeGreaterThan(0.99);
  });
});

describe('flattenUnevenBackground', () => {
  it('leaves a uniform page alone', () => {
    expect(flattenUnevenBackground(paintedImage(() => 240))).toBeNull();
  });

  it('leaves mild paper grain alone', () => {
    // ±6 levels of deterministic grain on white paper is not uneven lighting.
    const grain = (x: number, y: number): number => 245 + (((x * 7 + y * 13) % 13) - 6);
    expect(flattenUnevenBackground(paintedImage(grain))).toBeNull();
  });

  it('does not mistake a large solid shape on flat paper for shading', () => {
    // A block far wider than any smoothing window has a flat interior like
    // dark paper would; only its sharp edge tells it apart from lighting.
    for (const shade of [0, 120, 200]) {
      const image = paintedImage((x, y) =>
        x >= 100 && x < 300 && y >= 20 && y < 180 ? shade : 240,
      );
      const result = otsuBinarization(image);
      expect(result.flattened).toBe(false);
      expect(result.source).toBe(image);
    }
  });

  it('declines when light strokes sit on a dark page', () => {
    // Light-on-dark art has no smooth bright paper surface to divide by.
    const image = paintedImage((x, y) => (x % 60 < 4 || y % 50 < 4 ? 240 : 25));
    expect(flattenUnevenBackground(image)).toBeNull();
  });

  it('levels a 150→250 paper ramp so one cut separates ink from paper', () => {
    const image = paintedImage(ramp);
    const global = inkClassification(image, otsuThreshold(image));
    // The reproduced failure: the global cut swallows the dark half of the page.
    expect(global.fp).toBeGreaterThan(10_000);
    const flat = flattenUnevenBackground(image);
    expect(flat).not.toBeNull();
    const cut = otsuThreshold(flat!);
    expect(inkClassification(flat!, cut)).toEqual({ fp: 0, fn: 0 });
  });

  it('bridges a solid ink block instead of reading it as dark paper', () => {
    // A 100×100 block spans about eleven cells; its interior cells must be
    // excluded and filled from the surrounding paper, or it hollows out.
    const data = paintedImage(ramp);
    for (let y = 60; y < 160; y += 1) {
      for (let x = 250; x < 350; x += 1) {
        const o = (y * W + x) * 4;
        data.data[o] = INK_LUMA;
        data.data[o + 1] = INK_LUMA;
        data.data[o + 2] = INK_LUMA;
      }
    }
    const flat = flattenUnevenBackground(data);
    expect(flat).not.toBeNull();
    const cut = otsuThreshold(flat!);
    let hollow = 0;
    for (let y = 60; y < 160; y += 1) {
      for (let x = 250; x < 350; x += 1) {
        if ((flat!.data[(y * W + x) * 4] ?? 255) >= cut) hollow += 1;
      }
    }
    expect(hollow).toBe(0);
  });
});

describe('otsuBinarization', () => {
  it('returns the input ref-equal with the historical cut on a uniform page', () => {
    const image = paintedImage(() => 235);
    const result = otsuBinarization(image);
    expect(result.flattened).toBe(false);
    expect(result.source).toBe(image);
    expect(result.threshold).toBe(otsuThreshold(image));
  });

  it('flattens the ramp page and cuts between ink and paper', () => {
    const image = paintedImage(ramp);
    const result = otsuBinarization(image);
    expect(result.flattened).toBe(true);
    expect(inkClassification(result.source, result.threshold)).toEqual({ fp: 0, fn: 0 });
  });

  it('keeps a gentle slope under high-contrast ink cleanly classified', () => {
    // 225 to 250: whichever path the policy takes, the cut stays between ink and paper.
    const image = paintedImage((x) => Math.round(225 + (25 * x) / (W - 1)));
    const result = otsuBinarization(image);
    expect(inkClassification(result.source, result.threshold)).toEqual({ fp: 0, fn: 0 });
  });

  it('falls back to the global cut when flattening finds no ink to separate', () => {
    // An inkless unevenly lit page flattens to near-constant paper; a cut
    // through that is not credibly two-class, so the global cut is kept.
    const data = new Uint8ClampedArray(W * H * 4);
    for (let p = 0; p < W * H; p += 1) {
      const v = ramp(p % W);
      data.set([v, v, v, 255], p * 4);
    }
    const image = { width: W, height: H, data };
    expect(flattenUnevenBackground(image)).not.toBeNull();
    const result = otsuBinarization(image);
    expect(result.flattened).toBe(false);
    expect(result.source).toBe(image);
  });
});
