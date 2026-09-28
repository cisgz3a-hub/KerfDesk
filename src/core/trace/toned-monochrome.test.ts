// ADR-532: sepia / duotone artwork (one weak tint riding on its tones, on
// paper-light paper) is traced like greyscale art; multi-hue, saturated and
// tinted-paper images keep the colour promotion of ADR-401.
import { describe, expect, it } from 'vitest';
import { shouldUseSketchTrace } from './auto-sketch-trace';
import { upscaleBy } from './auto-upscale';
import type { RawImageData } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';
import { traceImageToColoredPaths } from './trace-to-paths';

const LINE_ART = TRACE_PRESETS['Line Art']!;
const SIZE = 240;
type Rgb = readonly [number, number, number];

/** A radial tone ramp (dark centre to light rim, radius 100) on paper; each
 *  pixel is its grey level plus `tint(x, darkness)`. */
function toneDisc(paper: Rgb, tint: (x: number, darkness: number) => Rgb): RawImageData {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1)
    for (let x = 0; x < SIZE; x += 1) {
      const o = (y * SIZE + x) * 4;
      const r = Math.hypot(x - SIZE / 2, y - SIZE / 2);
      const rgb: Rgb =
        r < 100
          ? ((): Rgb => {
              const level = 20 + 2.1 * r;
              const [tr, tg, tb] = tint(x, 255 - level);
              return [level + tr, level + tg, level + tb];
            })()
          : paper;
      data[o] = rgb[0];
      data[o + 1] = rgb[1];
      data[o + 2] = rgb[2];
      data[o + 3] = 255;
    }
  return { width: SIZE, height: SIZE, data };
}

const WARM_PAPER: Rgb = [253, 251, 246];
/** Toning grows with darkness, as in a sepia print: spread 30 at the darkest. */
const SEPIA = (_x: number, darkness: number): Rgb => [0.06 * darkness, 0, -0.07 * darkness];
const COOL = (_x: number, darkness: number): Rgb => [-0.07 * darkness, 0, 0.06 * darkness];

describe('toned monochrome artwork is traced like greyscale (ADR-532)', () => {
  it('does not promote a sepia tone ramp on paper-light paper', () => {
    const image = toneDisc(WARM_PAPER, SEPIA);
    expect(shouldUseSketchTrace(image, LINE_ART)).toBe(false);
  });

  it('does not promote a cool (blue-grey) tone ramp either', () => {
    expect(shouldUseSketchTrace(toneDisc([255, 255, 255], COOL), LINE_ART)).toBe(false);
  });

  it('still promotes the same ramp when two hues share it', () => {
    const image = toneDisc(WARM_PAPER, (x, darkness) => (x < SIZE / 2 ? SEPIA : COOL)(x, darkness));
    expect(shouldUseSketchTrace(image, LINE_ART)).toBe(true);
  });

  it('still promotes a saturated tint of the same ramp', () => {
    const image = toneDisc(WARM_PAPER, () => [40, 0, -45]);
    expect(shouldUseSketchTrace(image, LINE_ART)).toBe(true);
  });

  it('keeps the promotion on cream paper, where the local test separates strokes', () => {
    expect(shouldUseSketchTrace(toneDisc([240, 232, 214], SEPIA), LINE_ART)).toBe(true);
  });

  it('keeps the promotion for a saturated accent on sepia art', () => {
    const image = toneDisc(WARM_PAPER, SEPIA);
    for (let y = 10; y < 40; y += 1)
      for (let x = 10; x < 40; x += 1) image.data.set([173, 216, 230], (y * SIZE + x) * 4);
    expect(shouldUseSketchTrace(image, LINE_ART)).toBe(true);
  });

  it('gates on paper luma 245: 245 keeps the veto, 244 is promoted', () => {
    expect(shouldUseSketchTrace(toneDisc([245, 245, 245], SEPIA), LINE_ART)).toBe(false);
    expect(shouldUseSketchTrace(toneDisc([244, 244, 244], SEPIA), LINE_ART)).toBe(true);
  });

  it('holds the veto on a noisy sepia ramp (up to 4 levels per channel)', () => {
    const image = toneDisc(WARM_PAPER, SEPIA);
    let seed = 12345;
    const noise = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return Math.round((seed / 2147483648) * 8 - 4);
    };
    for (let i = 0; i < image.data.length; i += 4)
      for (let c = 0; c < 3; c += 1) image.data[i + c] = (image.data[i + c] as number) + noise();
    expect(shouldUseSketchTrace(image, LINE_ART)).toBe(false);
  });

  // With white paper a tint of k * darkness is weak at k = 0.18 for every
  // tone (the limit is 0.2 * darkness + 6) and strong at k = 0.24 once the
  // tone is more than about 135 levels below the paper.
  it.each([
    { k: 0.18, promoted: false },
    { k: 0.24, promoted: true },
  ])('places the tint limit between k = 0.18 and 0.24 (k = $k)', ({ k, promoted }) => {
    const image = toneDisc([255, 255, 255], (_x, darkness) => [
      (k * darkness) / 2,
      0,
      (-k * darkness) / 2,
    ]);
    expect(shouldUseSketchTrace(image, LINE_ART)).toBe(promoted);
  });
});

const GREIGE: Rgb = [200, 190, 175];
/** A toned brown whose tint is strong in full but weak at two thirds. */
const TONED_BROWN: Rgb = [140, 124, 100];

/** 2 px strokes of `ink` every 10 px on warm paper. */
function strokes(size: number, ink: Rgb): RawImageData {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const stroke = x >= 10 && x < size - 10 && y >= 10 && y % 10 < 2;
      data.set(stroke ? [...ink, 255] : [...WARM_PAPER, 255], (y * size + x) * 4);
    }
  return { width: size, height: size, data };
}

describe('thin pale-toned strokes (ADR-532)', () => {
  it('vetoes 2 px greige strokes at source scale', () => {
    expect(shouldUseSketchTrace(strokes(300, GREIGE), LINE_ART)).toBe(false);
  });

  // The 3x3 window sees a 2 px stroke's tint at two thirds and a 4 px one's
  // in full, so the 2x thin-stroke working grid alone would promote TONED_BROWN
  // strokes the source vetoes: the trace must carry the source verdict onto it.
  it('traces thin strokes on their 2x working grid with the source verdict', async () => {
    const image = strokes(90, TONED_BROWN);
    expect(shouldUseSketchTrace(image, LINE_ART)).toBe(false);
    expect(shouldUseSketchTrace(upscaleBy(image, 2), LINE_ART)).toBe(true);
    const traced = await traceImageToColoredPaths(image, LINE_ART);
    const vetoed = await traceImageToColoredPaths(image, { ...LINE_ART, sourceAutoSketch: false });
    const promoted = await traceImageToColoredPaths(image, { ...LINE_ART, sourceAutoSketch: true });
    expect(traced).toEqual(vetoed);
    expect(traced).not.toEqual(promoted);
  });
});
