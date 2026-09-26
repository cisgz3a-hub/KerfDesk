// ADR-446: sepia / duotone artwork (one weak tint riding on its tones, on
// paper-light paper) is traced like greyscale art; multi-hue, saturated and
// tinted-paper images keep the colour promotion of ADR-401.
import { describe, expect, it } from 'vitest';
import { shouldUseSketchTrace } from './auto-sketch-trace';
import type { RawImageData } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';

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

describe('toned monochrome artwork is traced like greyscale (ADR-446)', () => {
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
});
