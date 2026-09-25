import { describe, expect, it } from 'vitest';
import {
  flattenUnevenBackground,
  levelForAutomaticThreshold,
  otsuBinarization,
} from './background-flatten';
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

function greyPixels(values: readonly number[]): RawImageData {
  const data = new Uint8ClampedArray(values.length * 4);
  values.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  return { width: values.length, height: 1, data };
}

describe('otsuSeparation', () => {
  it('matches a hand-computed cut, separability and class contrast', () => {
    // Luma {0, 0, 100, 200}: mean 75, total scatter 2·75² + 25² + 125² =
    // 27,500. Cut after 0: classes {0, 0} | {100, 200}, between-class
    // scatter wB·wF·Δ²/N = 2·2·150²/4 = 22,500. Cut after 100: {0, 0, 100}
    // | {200}, 3·1·(200 − 100/3)²/4 ≈ 20,833. So the cut is after 0
    // (threshold 1: luma < 1 is ink), η = 22,500 / 27,500 = 9/11, and the
    // class means are 150 apart.
    const result = otsuSeparation(greyPixels([0, 0, 100, 200]));
    expect(result.threshold).toBe(1);
    expect(result.separability).toBeCloseTo(9 / 11, 12);
    expect(result.contrast).toBe(150);
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

  it('keeps the global cut for light strokes on an unevenly lit dark page', () => {
    // The dark page is the largest smooth region, so it is taken as the
    // paper; flattening saturates the light strokes into it and leaves no
    // second class, so the historical path is kept.
    const image = paintedImage((x, y) =>
      x % 60 < 4 || y % 50 < 4 ? 230 : Math.round(40 + (40 * x) / W),
    );
    const result = otsuBinarization(image);
    expect(result.flattened).toBe(false);
    expect(result.source).toBe(image);
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

  it('is not fooled by a white margin brighter than the paper', () => {
    // A 20 px white (255) margin round the 150 → 250 ramp: scanner lid
    // round a smaller sheet. The margin joins the sheet at its lit end, so
    // only the surface fit can tell it is not paper. Seeding from the
    // brightest cell, or a least-squares fit, took the margin as the paper
    // and traced the dark half of the sheet as ink (IoU 0.04).
    const margin = (x: number, y: number): number =>
      x < 20 || y < 20 || x >= W - 20 || y >= H - 20 ? 255 : ramp(x);
    const image = paintedImage(margin);
    expect(inkClassification(image, otsuThreshold(image)).fp).toBeGreaterThan(10_000);
    const result = otsuBinarization(image);
    expect(result.flattened).toBe(true);
    expect(inkClassification(result.source, result.threshold)).toEqual({ fp: 0, fn: 0 });
  });

  it('is not fooled by a white margin that never touches the paper level', () => {
    // 150 → 220 paper inside a 20 px white margin: the margin is a separate
    // sharp-edged region and saturates into the paper instead of forming a
    // third histogram class above it.
    const image = paintedImage((x, y) =>
      x < 20 || y < 20 || x >= W - 20 || y >= H - 20 ? 255 : Math.round(150 + (70 * x) / (W - 1)),
    );
    const result = otsuBinarization(image);
    expect(result.flattened).toBe(true);
    expect(inkClassification(result.source, result.threshold)).toEqual({ fp: 0, fn: 0 });
  });

  it('is not fooled by a glare patch brighter than the paper', () => {
    // A 40×40 white patch on a 150 → 220 ramp, away from the ink.
    const image = paintedImage((x, y) =>
      x >= 300 && x < 340 && y >= 30 && y < 70 ? 255 : Math.round(150 + (70 * x) / (W - 1)),
    );
    const result = otsuBinarization(image);
    expect(result.flattened).toBe(true);
    expect(inkClassification(result.source, result.threshold)).toEqual({ fp: 0, fn: 0 });
  });

  it('flattens the ramp page and cuts between ink and paper', () => {
    const image = paintedImage(ramp);
    const result = otsuBinarization(image);
    expect(result.flattened).toBe(true);
    expect(inkClassification(result.source, result.threshold)).toEqual({ fp: 0, fn: 0 });
  });

  it('flattens a gentle slope without harming a split the global cut already gets right', () => {
    // Non-regression guard. 225 → 250 is just past the uniformity ratio
    // (225 / 250 = 0.90 < 0.92), so the gate flattens; the global cut also
    // classifies this page perfectly, and flattening must not undo that.
    const image = paintedImage((x) => Math.round(225 + (25 * x) / (W - 1)));
    expect(inkClassification(image, otsuThreshold(image))).toEqual({ fp: 0, fn: 0 });
    const result = otsuBinarization(image);
    expect(result.flattened).toBe(true);
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

describe('levelForAutomaticThreshold', () => {
  const automatic = { useOtsuThreshold: true } as const;

  it('hands back the automatic cut of the luma it returns', () => {
    // The caller thresholds with this value instead of a second Otsu pass.
    for (const image of [paintedImage(() => 235), paintedImage(ramp)]) {
      const level = levelForAutomaticThreshold(image, automatic);
      expect(level.threshold).toBe(otsuThreshold(level.source));
    }
  });

  it('leaves explicit cut settings alone', () => {
    const image = paintedImage(ramp);
    for (const options of [
      { useOtsuThreshold: true, thresholdLuma: 128 },
      { useOtsuThreshold: true, cutoffLuma: 0, thresholdLuma: 128 },
      { useOtsuThreshold: false },
    ]) {
      expect(levelForAutomaticThreshold(image, options)).toEqual({
        source: image,
        threshold: null,
      });
    }
  });
});
