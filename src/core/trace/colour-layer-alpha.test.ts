import { describe, expect, it } from 'vitest';
import type { RawImageData } from './trace-image';
import { traceImageToColoredPaths } from './trace-to-paths';
import { canvas, covers, fillRect, OPTIONS, type Rgb } from './colour-layer-trace.test-support';

const COLOURS: ReadonlyArray<Rgb> = [
  [0, 0, 0],
  [180, 20, 80],
];
const SETTINGS = { ...OPTIONS, despeckleMinPixels: 0, colourLayers: { colours: 2 } };

// Independent representation oracle: the UI's tagged data stores its visible
// white-composited RGB while preserving the original alpha, not straight RGB.
function whiteComposite(image: RawImageData, retainAlpha: boolean): RawImageData {
  const data = image.data.slice();
  for (let i = 0; i < data.length; i += 4) {
    const alpha = (image.data[i + 3] ?? 0) / 255;
    for (let channel = 0; channel < 3; channel += 1) {
      data[i + channel] = Math.round((image.data[i + channel] ?? 0) * alpha + 255 * (1 - alpha));
    }
    if (!retainAlpha) data[i + 3] = 255;
  }
  return { ...image, data, rgbCompositedOnWhite: retainAlpha };
}

function artwork(alpha: number, colour: Rgb): RawImageData {
  const image = canvas(80, 60, [255, 255, 255]);
  fillRect(image, 20, 15, 60, 45, colour);
  for (let y = 15; y < 45; y += 1)
    for (let x = 20; x < 60; x += 1) {
      image.data[(y * image.width + x) * 4 + 3] = alpha;
    }
  return image;
}

describe('colour-layer appearance of partial alpha', () => {
  it.each([1, 64, 127, 128, 192, 255])(
    'agrees across straight, tagged and flattened alpha %s',
    async (alpha) => {
      for (const colour of COLOURS) {
        const raw = artwork(alpha, colour);
        const before = raw.data.slice();
        const flattened = await traceImageToColoredPaths(whiteComposite(raw, false), SETTINGS);
        expect(await traceImageToColoredPaths(raw, SETTINGS)).toEqual(flattened);
        expect(await traceImageToColoredPaths(whiteComposite(raw, true), SETTINGS)).toEqual(
          flattened,
        );
        expect(raw.data).toEqual(before);
        // Alpha=1 can legitimately quantize into paper; visible medium tones cannot.
        if (alpha >= 64) {
          expect(flattened).toHaveLength(1);
          const path = flattened[0];
          if (path === undefined) continue;
          expect(covers(path, { x: 40.5, y: 30.5 })).toBe(true);
          expect(covers(path, { x: 4.5, y: 4.5 })).toBe(false);
        }
      }
    },
  );

  it.each([false, true])(
    'honours Keep background=%s around translucent artwork',
    async (keepBackground) => {
      const image = artwork(127, [0, 0, 0]);
      const options = { ...SETTINGS, colourLayers: { colours: 2, keepBackground } };
      const expected = await traceImageToColoredPaths(whiteComposite(image, false), options);
      const paths = await traceImageToColoredPaths(whiteComposite(image, true), options);
      expect(paths).toEqual(expected);
      expect(paths.map((path) => path.color)).toEqual(
        keepBackground ? ['#ffffff', '#808080'] : ['#808080'],
      );
      expect(paths.some((path) => covers(path, { x: 5.5, y: 5.5 }))).toBe(keepBackground);
    },
  );

  it('ignores hidden RGB and retains white artwork and holes on a transparent canvas', async () => {
    const image = canvas(60, 60, [240, 10, 90]);
    for (let i = 3; i < image.data.length; i += 4) image.data[i] = 0;
    fillRect(image, 15, 15, 45, 45, [255, 255, 255]);
    for (let y = 15; y < 45; y += 1)
      for (let x = 15; x < 45; x += 1) {
        image.data[(y * image.width + x) * 4 + 3] = 255;
      }
    for (let y = 25; y < 35; y += 1)
      for (let x = 25; x < 35; x += 1) {
        image.data[(y * image.width + x) * 4 + 3] = 0;
      }
    const tagged = whiteComposite(image, true);
    for (const keepBackground of [false, true]) {
      const options = { ...SETTINGS, colourLayers: { colours: 2, keepBackground } };
      const paths = await traceImageToColoredPaths(image, options);
      expect(paths).toEqual(await traceImageToColoredPaths(tagged, options));
      expect(paths).toHaveLength(1);
      const white = paths[0];
      expect(white?.color).toBe('#ffffff');
      if (white === undefined) continue;
      expect(covers(white, { x: 20.5, y: 20.5 })).toBe(true);
      expect(covers(white, { x: 30.5, y: 30.5 })).toBe(false);
      expect(covers(white, { x: 5.5, y: 5.5 })).toBe(false);
    }
  });

  it('does not promote hidden colour on an entirely transparent image', async () => {
    const image = artwork(0, [200, 0, 0]);
    for (let i = 3; i < image.data.length; i += 4) image.data[i] = 0;
    expect(await traceImageToColoredPaths(image, SETTINGS)).toEqual([]);
    expect(await traceImageToColoredPaths(whiteComposite(image, true), SETTINGS)).toEqual([]);
  });
});
