// Synthetic scenes for the Line Art light-solid tests (ADR-401): flat colour
// squares, noise models, photographed-paper shadows and drawn-on surfaces.
import type { RawImageData } from '../core/trace/trace-image';
import { blank, rect } from './auto-detail-trace';

export type Rgb = readonly [number, number, number];

export const SIZE = 280;
export const SQUARE = { x: 40, y: 40, side: 200 } as const;

export const COLOURS = {
  red: [220, 30, 30],
  blue: [30, 60, 200],
  gold: [212, 160, 23],
  orange: [255, 140, 0],
  tan: [210, 180, 140],
  lightBlue: [173, 216, 230],
  pink: [255, 192, 203],
} as const satisfies Record<string, Rgb>;

export function lcg(seed: number): () => number {
  let state = seed;
  return () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 2 ** 32;
}

/** Independent uniform noise of ±amplitude on each channel. */
export function addChannelNoise(image: RawImageData, amplitude: number, seed: number): void {
  const rnd = lcg(seed);
  for (let i = 0; i < image.width * image.height; i++)
    for (let c = 0; c < 3; c++)
      image.data[4 * i + c] =
        image.data[4 * i + c]! + Math.round(rnd() * 2 * amplitude - amplitude);
}

/** Gaussian luma noise of the given sd, the same offset on all channels. */
export function addLumaNoise(image: RawImageData, sd: number, seed: number): void {
  const rnd = lcg(seed);
  for (let i = 0; i < image.width * image.height; i++) {
    const g = Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
    const offset = Math.round(g * sd);
    for (let c = 0; c < 3; c++) image.data[4 * i + c] = image.data[4 * i + c]! + offset;
  }
}

/** A 200 px square of `rgb` on a 280 px white canvas. */
export function square(rgb: Rgb, noise = 0, seed = 1): RawImageData {
  const image = blank(SIZE, SIZE);
  rect(image, SQUARE.x, SQUARE.y, SQUARE.side, SQUARE.side, [...rgb, 255]);
  if (noise > 0) {
    // Noise only inside the square keeps the paper clean, as on a flat print.
    const rnd = lcg(seed);
    for (let y = SQUARE.y; y < SQUARE.y + SQUARE.side; y++)
      for (let x = SQUARE.x; x < SQUARE.x + SQUARE.side; x++)
        for (let c = 0; c < 3; c++)
          image.data[4 * (y * SIZE + x) + c] = rgb[c]! + Math.round(rnd() * 2 * noise - noise);
  }
  return image;
}

/** Ink pixels (value < 128) of a prepared mask inside a rectangle. */
export function inkIn(mask: RawImageData, x0: number, y0: number, w: number, h: number): number {
  let ink = 0;
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) if (mask.data[4 * (y * mask.width + x)]! < 128) ink++;
  return ink;
}

const PENCIL = [140, 135, 130, 255];
const CREAM_PAPER: Rgb = [245, 240, 228];

/** Photographed cream paper whose right half lies in a hard-edged shadow
 *  `depth` darker, with pencil lines crossing both halves. */
export function shadowedSketch(depth: number): RawImageData {
  const image = blank(400, 300);
  for (let y = 0; y < 300; y++)
    for (let x = 0; x < 400; x++) {
      const d = x >= 200 ? depth : 0;
      image.data.set(
        [CREAM_PAPER[0] - d, CREAM_PAPER[1] - d, CREAM_PAPER[2] - d, 255],
        4 * (y * 400 + x),
      );
    }
  rect(image, 50, 60, 300, 2, PENCIL);
  rect(image, 120, 30, 1, 240, PENCIL);
  rect(image, 300, 100, 1, 150, PENCIL);
  return image;
}

/** Cream paper with a round shadow (radius 90) crossed by two pencil lines. */
export function shadowBlob(depth: number): RawImageData {
  const image = blank(400, 300);
  for (let y = 0; y < 300; y++)
    for (let x = 0; x < 400; x++) {
      const d = Math.hypot(x - 200, y - 150) < 90 ? depth : 0;
      image.data.set(
        [CREAM_PAPER[0] - d, CREAM_PAPER[1] - d, CREAM_PAPER[2] - d, 255],
        4 * (y * 400 + x),
      );
    }
  rect(image, 60, 150, 280, 2, PENCIL);
  rect(image, 200, 20, 1, 260, PENCIL);
  return image;
}

/** A 260 px sheet inset 20 px in a white 300 px frame, carrying a pencil
 *  circle (radius 70) and a line; ±3 noise. */
export function sheetWithDrawing(sheet: Rgb): RawImageData {
  const image = blank(300, 300);
  rect(image, 20, 20, 260, 260, [...sheet, 255]);
  for (let y = 0; y < 300; y++)
    for (let x = 0; x < 300; x++)
      if (Math.abs(Math.hypot(x - 150, y - 150) - 70) < 0.6)
        image.data.set(PENCIL, 4 * (y * 300 + x));
  rect(image, 60, 250, 180, 1, PENCIL);
  addChannelNoise(image, 3, 17);
  return image;
}

/** Ink pixels the sheet's pencil drawing covers before any noise: 500 on the
 *  circle plus 180 on the line. (Four-connected despeckle, before ADR-403,
 *  erased 216 of the circle's diagonal-arc pixels and left 464.) */
export const SHEET_DRAWING_PX = 680;

/** A light plate (260×160, inset 20) carrying eight dark "T" glyphs, plus a
 *  red corner mark that makes the image colourful. */
export function plateWithText(plate: Rgb): RawImageData {
  const image = blank(300, 200);
  rect(image, 20, 20, 260, 160, [...plate, 255]);
  for (let k = 0; k < 8; k++) {
    rect(image, 50 + k * 28, 70, 4, 50, 20);
    rect(image, 50 + k * 28, 70, 18, 4, 20);
  }
  rect(image, 10, 10, 20, 20, [200, 30, 30, 255]);
  return image;
}

/** Ink pixels of the plate's eight glyphs. */
export const PLATE_TEXT_PX = 2048;
