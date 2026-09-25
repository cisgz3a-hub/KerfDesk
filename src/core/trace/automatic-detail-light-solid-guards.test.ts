// ADR-393: what the Line Art light-solid fill must and must not do on
// realistic input — pixel noise, pale solids split or outlined by dark lines,
// nested colours, frames at the image edge, photographed shadows and light
// surfaces that carry a drawing.
import { describe, expect, it } from 'vitest';
import { blank, rect } from '../../__fixtures__/auto-detail-trace';
import {
  addChannelNoise,
  addLumaNoise,
  COLOURS,
  inkIn,
  PLATE_TEXT_PX,
  plateWithText,
  type Rgb,
  shadowBlob,
  shadowedSketch,
  SHEET_DRAWING_PX,
  sheetWithDrawing,
  SIZE,
  square,
  SQUARE,
} from '../../__fixtures__/light-solid-scenes';
import { rasterizeColoredPaths } from '../../__fixtures__/perceptual/rasterize';
import { shouldUseSketchTrace } from './auto-sketch-trace';
import { prepareTraceForContour, type RawImageData } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';
import { traceImageToColoredPaths } from './trace-to-paths';

const LINE_ART = TRACE_PRESETS['Line Art']!;
const TRUTH = SQUARE.side * SQUARE.side;
const PALE = [
  ['gold', COLOURS.gold],
  ['tan', COLOURS.tan],
  ['light blue', COLOURS.lightBlue],
  ['pink', COLOURS.pink],
  ['orange', COLOURS.orange],
] as const;

const mask = (image: RawImageData): RawImageData =>
  prepareTraceForContour(image, LINE_ART).prepared;
const squareInk = (image: RawImageData): number =>
  inkIn(mask(image), SQUARE.x, SQUARE.y, SQUARE.side, SQUARE.side);

describe('light solids survive realistic pixel noise (ADR-393)', () => {
  const noises = [
    ['luma sd 6', (im: RawImageData) => addLumaNoise(im, 6, 3)],
    ['luma sd 8', (im: RawImageData) => addLumaNoise(im, 8, 3)],
    ['channel ±16', (im: RawImageData) => addChannelNoise(im, 16, 5)],
  ] as const;
  it.each(
    PALE.slice(0, 3).flatMap(([name, rgb]) =>
      noises.map(([n, add]) => [name, n, rgb, add] as const),
    ),
  )(
    '%s square with %s noise over the whole image traces as one filled contour',
    async (_name, _noise, rgb, add) => {
      const image = square(rgb);
      add(image);
      expect(shouldUseSketchTrace(image, LINE_ART)).toBe(true);
      const paths = await traceImageToColoredPaths(image, LINE_ART);
      expect(paths.flatMap((p) => p.polylines)).toHaveLength(1);
      const raster = rasterizeColoredPaths(paths, SIZE, SIZE);
      let ink = 0;
      for (const v of raster.data) ink += v;
      expect(Math.abs(ink - TRUTH) / TRUTH).toBeLessThan(0.02);
    },
  );
});

describe('dark lines reaching a light solid do not keep it hollow (ADR-393)', () => {
  it.each(PALE)('%s square crossed edge to edge by black lines fills', (_name, rgb) => {
    const crossed = square(rgb);
    rect(crossed, 40, 138, 200, 3, 30);
    rect(crossed, 138, 40, 3, 200, 30);
    expect(squareInk(crossed)).toBe(TRUTH);
    for (let k = 0; k < 6; k++) rect(crossed, 60 + k * 30, 40, 2, 200, 30);
    expect(squareInk(crossed)).toBe(TRUTH);
  });

  it('fills both halves of a solid split by a 1 px paper hairline, keeping the hairline', () => {
    const split = square(COLOURS.gold);
    rect(split, 30, 139, 220, 1, 255);
    expect(inkIn(mask(split), 0, 0, SIZE, SIZE)).toBe(TRUTH - SQUARE.side);
  });

  it('fills a solid inside a frame line drawn at the image edge', () => {
    const framed = square(COLOURS.gold);
    rect(framed, 0, 0, SIZE, 3, 0);
    rect(framed, 0, SIZE - 3, SIZE, 3, 0);
    rect(framed, 0, 0, 3, SIZE, 0);
    rect(framed, SIZE - 3, 0, 3, SIZE, 0);
    expect(squareInk(framed)).toBe(TRUTH);
  });
});

describe('light shapes cut out of dark ink stay open (ADR-393)', () => {
  it('keeps a gold square inside a wide black badge open, as a threshold would', () => {
    const badge = blank(SIZE, SIZE);
    rect(badge, 40, 40, 200, 200, 0);
    rect(badge, 100, 100, 80, 80, [...COLOURS.gold, 255]);
    expect(inkIn(mask(badge), 110, 110, 60, 60)).toBe(0);
  });

  it('keeps pale letters on a dark plate open', () => {
    const plate = blank(300, 200);
    rect(plate, 20, 20, 260, 160, 0);
    for (let k = 0; k < 6; k++) rect(plate, 50 + k * 36, 50, 14, 100, [250, 210, 40, 255]);
    // Only the dark plate between the letters is ink.
    expect(inkIn(mask(plate), 50, 50, 200, 100)).toBe(200 * 100 - 6 * 14 * 100);
  });

  it('keeps a light shape on a dark ground reaching the image border open', () => {
    const ground = blank(SIZE, SIZE);
    rect(ground, 0, 0, SIZE, 230, 0);
    rect(ground, 90, 60, 100, 100, [...COLOURS.lightBlue, 255]);
    expect(inkIn(mask(ground), 100, 70, 80, 80)).toBe(0);
  });

  it('leaves a gradient fill (a 38-luma ramp) to the local test, as before', () => {
    const image = square(COLOURS.gold);
    for (let y = SQUARE.y; y < SQUARE.y + SQUARE.side; y++) {
      const t = (y - SQUARE.y) / SQUARE.side;
      rect(image, SQUARE.x, y, SQUARE.side, 1, [212 + 23 * t, 160 + 36 * t, 23 + 84 * t, 255]);
    }
    expect(inkIn(mask(image), 70, 70, 140, 140)).toBe(0);
  });

  it('still fills a light solid inside a 10 px outline', () => {
    const outlined = blank(SIZE, SIZE);
    rect(outlined, 40, 40, 200, 200, 0);
    rect(outlined, 50, 50, 180, 180, [...COLOURS.gold, 255]);
    expect(squareInk(outlined)).toBe(TRUTH);
  });
});

describe('nested flat colours keep their own edges (ADR-393)', () => {
  it.each([
    ['gold', 'light blue', COLOURS.gold, COLOURS.lightBlue],
    ['tan', 'light blue', COLOURS.tan, COLOURS.lightBlue],
    ['gold', 'tan', COLOURS.gold, COLOURS.tan],
    ['light blue', 'gold', COLOURS.lightBlue, COLOURS.gold],
  ] as const)('%s square with a %s inset fills completely', (_a, _b, outer, inner) => {
    const image = square(outer);
    rect(image, 90, 90, 100, 100, [...inner, 255]);
    expect(squareInk(image)).toBe(TRUTH);
  });

  it('a grey inset in a gold square stays open without a shell eating into it', () => {
    const image = square(COLOURS.gold);
    rect(image, 90, 90, 100, 100, [205, 205, 205, 255]);
    const inset = inkIn(mask(image), 90, 90, 100, 100);
    // Only the corners of the inset, where the local test reads gold on two
    // sides, may be marked; no band along its straight edges.
    expect(inset).toBeLessThan(50);
    expect(inkIn(mask(image), 0, 0, SIZE, SIZE) - inset).toBe(TRUTH - 10000);
  });
});

describe('paper, shadows and drawn-on surfaces are never filled (ADR-393)', () => {
  // The shadow's own edge is marked by the local test, as before; beyond it
  // only the pencil lines may be ink.
  it.each([40, 60, 80])('a hard %i-deep cast shadow on cream paper stays paper', (depth) => {
    for (const noise of [0, 6, 8, 12]) {
      const image = shadowedSketch(depth);
      if (noise > 0) addChannelNoise(image, noise, depth + noise);
      expect(shouldUseSketchTrace(image, LINE_ART)).toBe(true);
      // Lines inside x ≥ 215: 135 × 2 horizontal + 150 vertical = 420 px.
      expect(inkIn(mask(image), 215, 0, 185, 300), `±${noise}`).toBeLessThan(600);
      const blob = shadowBlob(depth);
      if (noise > 0) addChannelNoise(blob, noise, depth + noise + 1);
      // Lines inside a 110 px box well within the blob's edge band: 330 px.
      expect(inkIn(mask(blob), 145, 95, 110, 110), `blob ±${noise}`).toBeLessThan(500);
    }
  });

  it.each<{ sheet: Rgb }>([
    { sheet: [238, 230, 215] },
    { sheet: [230, 225, 212] },
    { sheet: [242, 236, 222] },
    { sheet: [240, 225, 190] },
  ])(
    'a $sheet sheet with a pencil drawing inside a white margin keeps only its strokes',
    ({ sheet }) => {
      const image = sheetWithDrawing(sheet);
      expect(shouldUseSketchTrace(image, LINE_ART)).toBe(true);
      expect(inkIn(mask(image), 30, 30, 240, 240)).toBeLessThan(SHEET_DRAWING_PX * 1.3);
    },
  );

  it.each<{ plate: Rgb }>([
    { plate: [225, 225, 225] },
    { plate: [240, 230, 170] },
    { plate: [200, 225, 240] },
  ])('a $plate plate carrying dark text keeps only the text', ({ plate }) => {
    const image = plateWithText(plate);
    expect(inkIn(mask(image), 30, 30, 240, 140)).toBe(PLATE_TEXT_PX);
  });

  it('leaves a light solid cut by the image border to the local test', () => {
    const image = blank(SIZE, SIZE);
    rect(image, 0, 40, 200, 200, [...COLOURS.gold, 255]);
    // The interior away from paper stays open, as before ADR-393.
    expect(inkIn(mask(image), 40, 80, 100, 100)).toBe(0);
  });
});
