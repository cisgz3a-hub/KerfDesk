// ADR-410: Region Enhance patches must binarise and join like the full pass.
import { describe, expect, it } from 'vitest';
import { compareMasks } from '../../__fixtures__/perceptual/compare';
import { maximumPointDistanceToPolyline } from '../../__fixtures__/polyline-distance';
import { flattenCurveSubpath, type ColoredPath, type Polyline } from '../scene';
import { shouldUseSketchTrace } from './auto-sketch-trace';
import { upscaleBy } from './auto-upscale';
import { autoMedianFilter, otsuThreshold } from './preprocess';
import { enhanceRegionPaths } from './region-enhance';
import type { TraceBoundary } from './trace-boundary';
import { preprocessForTrace, type RawImageData, type TraceOptions } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';
import { resolveFrozenTraceSourceOptions } from './trace-source-decisions';
import { traceImageToColoredPaths } from './trace-to-paths';

type Rgb = readonly [number, number, number];
type Call = { readonly image: RawImageData; readonly options: TraceOptions };

function canvas(width: number, height: number, fill: (x: number, y: number) => Rgb): RawImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = fill(x, y);
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

function grey(v: number): Rgb {
  return [v, v, v];
}

// Fraction of a pixel covered by a disc, sampled 4x4.
function discCoverage(x: number, y: number, cx: number, cy: number, r: number): number {
  let hits = 0;
  for (let sy = 0; sy < 4; sy += 1) {
    for (let sx = 0; sx < 4; sx += 1) {
      const dx = x + (sx + 0.5) / 4 - cx;
      const dy = y + (sy + 0.5) / 4 - cy;
      if (dx * dx + dy * dy <= r * r) hits += 1;
    }
  }
  return hits / 16;
}

const preset = (name: string): TraceOptions => TRACE_PRESETS[name] as TraceOptions;

async function enhanceCapturing(
  image: RawImageData,
  options: TraceOptions,
  region: TraceBoundary,
): Promise<{ readonly full: ColoredPath[]; readonly out: ColoredPath[]; readonly call: Call }> {
  const frozen = resolveFrozenTraceSourceOptions(image, options);
  const full = await traceImageToColoredPaths(image, frozen);
  const calls: Call[] = [];
  const out = await enhanceRegionPaths({
    image,
    region,
    fullTracePaths: full,
    options,
    trace: (crop, derived) => {
      calls.push({ image: crop, options: derived });
      return traceImageToColoredPaths(crop, derived);
    },
  });
  expect(calls).toHaveLength(1);
  return { full, out, call: calls[0] as Call };
}

// IoU of two binary rasters (ink = R 0) over the box, both on the 2x grid.
function boxMaskIou(
  crop: RawImageData,
  reference: RawImageData,
  region: TraceBoundary,
  image: RawImageData,
): number {
  // The region sits well inside the image, so the padding is symmetric.
  const padX = (crop.width / 2 - region.width) / 2;
  const padY = (crop.height / 2 - region.height) / 2;
  expect(padX).toBeGreaterThan(0);
  expect(region.x - padX).toBeGreaterThanOrEqual(0);
  expect(reference.width).toBe(image.width * 2);
  const width = region.width * 2;
  const height = region.height * 2;
  const predicted = new Uint8Array(width * height);
  const truth = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const c = ((y + padY * 2) * crop.width + x + padX * 2) * 4;
      const r = ((y + region.y * 2) * reference.width + x + region.x * 2) * 4;
      predicted[y * width + x] = crop.data[c] === 0 ? 1 : 0;
      truth[y * width + x] = reference.data[r] === 0 ? 1 : 0;
    }
  }
  const metrics = compareMasks({ width, height, data: predicted }, { width, height, data: truth });
  expect(metrics.truePositive).toBeGreaterThan(0);
  return metrics.iou;
}

// Background darkens left to right past the cut the whole image's histogram
// picks; the box sits in the dark half, whose own histogram cuts far lower.
function lightingRamp(): RawImageData {
  const discs = [
    [40, 40],
    [100, 80],
    [170, 60],
    [200, 110],
    [140, 130],
  ] as const;
  return canvas(240, 160, (x, y) => {
    const ink = discs.some(([cx, cy]) => (x - cx) ** 2 + (y - cy) ** 2 < 100);
    return grey(ink ? 25 : Math.round(250 - (x / 239) * 170));
  });
}

describe('Region Enhance binarises the crop like the full pass (ADR-410)', () => {
  const region = { x: 150, y: 40, width: 70, height: 90 };

  it.each(['Sharp', 'Smooth', 'Centerline'])(
    '%s keeps the full image Otsu cut over a lighting ramp',
    async (name) => {
      const image = lightingRamp();
      const options = preset(name);
      const cut = otsuThreshold(image);
      expect(otsuThreshold(cropOf(image, region))).toBeLessThan(cut - 50);
      const { call } = await enhanceCapturing(image, options, region);
      expect(call.options.sourceOtsuThreshold).toBe(cut);
      const reference = preprocessForTrace(upscaleBy(image, 2), {
        ...options,
        pixelScale: 2,
        thresholdLuma: cut,
      });
      const iou = boxMaskIou(
        preprocessForTrace(call.image, call.options),
        reference,
        region,
        image,
      );
      expect(iou).toBeGreaterThanOrEqual(0.99);
    },
  );

  // Line Art counts coloured pixels against a floor of 0.2% of the image. A
  // pale gold stroke under that floor for the whole image clears it for a
  // crop, and a colourful image's verdict must reach a colourless crop.
  it.each([
    { verdict: false, colourElsewhere: false },
    { verdict: true, colourElsewhere: true },
  ])('Line Art keeps the full image auto-sketch verdict ($verdict)', async (c) => {
    const box = { x: 190, y: 70, width: 80, height: 60 };
    const image = canvas(400, 400, (x, y) => paleStrokeArt(x, y, c.colourElsewhere));
    const options = preset('Line Art');
    expect(shouldUseSketchTrace(image, options)).toBe(c.verdict);
    expect(shouldUseSketchTrace(upscaleBy(cropOf(image, box), 2), options)).toBe(!c.verdict);
    const { call } = await enhanceCapturing(image, options, box);
    expect(call.options.sourceAutoSketch).toBe(c.verdict);
    const reference = preprocessForTrace(upscaleBy(image, 2), { ...options, pixelScale: 2 });
    const iou = boxMaskIou(preprocessForTrace(call.image, call.options), reference, box, image);
    expect(iou).toBeGreaterThanOrEqual(0.99);
  });
});

// Smooth's automatic median repairs isolated impulses only when the whole
// image has enough of them, judged in pixels of the grid it runs on. The crop
// is enlarged 2x, where each speck is a supported 2x2 blob (ADR-411).
describe("Region Enhance repairs the crop's impulses like the full pass (ADR-411)", () => {
  const box = { x: 60, y: 60, width: 80, height: 80 };
  const salted = (x: number, y: number): boolean => x % 5 === 2 && y % 5 === 2;
  const image = canvas(200, 200, (x, y) => {
    const block = x >= 80 && x < 120 && y >= 70 && y < 130;
    if (block) return grey(salted(x, y) ? 255 : 0);
    return grey(salted(x + 1, y + 3) ? 0 : 255);
  });
  // The padded crop Region Enhance traced, cut from `source`.
  const paddedCrop = (source: RawImageData, call: Call): RawImageData => {
    const pad = (call.image.width / 2 - box.width) / 2;
    const side = { width: box.width + pad * 2, height: box.height + pad * 2 };
    return cropOf(source, { x: box.x - pad, y: box.y - pad, ...side });
  };

  it('removes the specks the full trace removed, and only those', async () => {
    const options = { ...preset('Smooth'), despeckleMinPixels: 0, fillPinholeCracks: false };
    const { call } = await enhanceCapturing(image, options, box);
    expect(call.options.sourceAutoMedian).toBe(true);
    expect(call.options.medianFilter).toBe(false);
    const frozen = resolveFrozenTraceSourceOptions(image, options);
    // The full pass's own cleaned source, then the crop's enlargement.
    const reference = preprocessForTrace(upscaleBy(autoMedianFilter(image), 2), {
      ...frozen,
      medianFilter: false,
      pixelScale: 2,
    });
    const patch = preprocessForTrace(call.image, call.options);
    expect(boxMaskIou(patch, reference, box, image)).toBe(1);
    // Control: the crop enlarged first keeps its specks.
    const late = preprocessForTrace(upscaleBy(paddedCrop(image, call), 2), {
      ...frozen,
      pixelScale: 2,
    });
    expect(boxMaskIou(late, reference, box, image)).toBeLessThan(0.97);
  });

  it("keeps the crop's specks when the whole image does not cross the floor", async () => {
    // Twelve specks in 40,000 pixels: 0.03%. The 80 x 80 crop alone has 0.19%
    // on its own grid, still under; the verdict, not the crop, decides.
    const sparse = canvas(200, 200, (x, y) =>
      grey(x >= 70 && x < 130 && y >= 90 && y < 110 && salted(x, y) && x % 10 === 2 ? 0 : 255),
    );
    const { call } = await enhanceCapturing(sparse, preset('Smooth'), box);
    expect(call.options.sourceAutoMedian).toBe(false);
    expect(call.options.medianFilter).toBe(false);
    expect(call.image.data).toEqual(upscaleBy(paddedCrop(sparse, call), 2).data);
  });

  // The next two separate the whole image's verdict from a density check on
  // the crop's own pixels: each crop alone would decide the other way.
  it('keeps specks packed in the box when only the crop crosses the floor', async () => {
    // 100 specks: 0.25% of the whole image, but about 1% of the padded crop.
    const packed = canvas(200, 200, (x, y) =>
      grey(x >= 64 && x < 140 && y >= 64 && y < 140 && x % 8 === 0 && y % 8 === 0 ? 0 : 255),
    );
    expect(autoMedianFilter(packed)).toBe(packed);
    const { call } = await enhanceCapturing(packed, preset('Smooth'), box);
    const crop = paddedCrop(packed, call);
    expect(autoMedianFilter(crop)).not.toBe(crop);
    expect(call.options.sourceAutoMedian).toBe(false);
    expect(call.image.data).toEqual(upscaleBy(crop, 2).data);
  });

  it("repairs the box's few specks when only the whole image crosses the floor", async () => {
    // 500 specks in 20 px bands at the left and right edges (1.25% of the
    // image), far outside the padded crop, and four in the box (0.04% of it).
    const inBox = new Set(['70,70', '100,100', '130,80', '90,130']);
    const edge = (x: number, y: number): boolean =>
      (x < 20 || x >= 180) && x % 4 === 1 && y % 4 === 1;
    const noisy = canvas(200, 200, (x, y) => grey(edge(x, y) || inBox.has(`${x},${y}`) ? 0 : 255));
    const clean = canvas(200, 200, (x, y) => grey(edge(x, y) ? 0 : 255));
    expect(autoMedianFilter(noisy)).not.toBe(noisy);
    const { call } = await enhanceCapturing(noisy, preset('Smooth'), box);
    const crop = paddedCrop(noisy, call);
    expect(autoMedianFilter(crop)).toBe(crop);
    expect(call.options.sourceAutoMedian).toBe(true);
    expect(call.options.medianFilter).toBe(false);
    // The crop holds the four specks and no edge speck, and they are repaired.
    expect(paddedCrop(clean, call).data).not.toEqual(crop.data);
    expect(call.image.data).toEqual(upscaleBy(paddedCrop(clean, call), 2).data);
  });
});

// Line Art's detail mask reads a 16 px window on the 2x grid. Dark blocks 3 px
// outside every box edge darken the neighbourhood of pale strokes just inside
// it; a crop without that context ring sees only paper there.
describe('Region Enhance traces the crop with its neighbourhood (ADR-410)', () => {
  const box = { x: 60, y: 60, width: 80, height: 80 };
  const image = canvas(200, 200, (x, y) => {
    const within = (x0: number, x1: number, y0: number, y1: number): boolean =>
      x >= x0 && x < x1 && y >= y0 && y < y1;
    const blocks = [
      within(40, 57, 70, 130),
      within(143, 160, 70, 130),
      within(70, 130, 40, 57),
      within(70, 130, 143, 160),
    ];
    if (blocks.some(Boolean)) return grey(20);
    const strokes = [
      within(61, 64, 65, 135),
      within(136, 139, 65, 135),
      within(65, 135, 61, 64),
      within(65, 135, 136, 139),
    ];
    if (strokes.some(Boolean)) return [215, 170, 70];
    if (within(10, 30, 170, 190)) return [200, 90, 60];
    return grey(235);
  });

  // IoU over the box's outer `ring` pixels on the 2x grid; the box starts at
  // (offset, offset) inside `mask`.
  function ringIou(
    mask: RawImageData,
    offset: number,
    reference: RawImageData,
    ring: number,
  ): number {
    const width = box.width * 2;
    const height = box.height * 2;
    const predicted = new Uint8Array(width * height);
    const truth = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (x >= ring && y >= ring && x < width - ring && y < height - ring) continue;
        const m = ((y + offset) * mask.width + x + offset) * 4;
        const r = ((y + box.y * 2) * reference.width + x + box.x * 2) * 4;
        predicted[y * width + x] = mask.data[m] === 0 ? 1 : 0;
        truth[y * width + x] = reference.data[r] === 0 ? 1 : 0;
      }
    }
    const metrics = compareMasks(
      { width, height, data: predicted },
      { width, height, data: truth },
    );
    expect(metrics.truePositive + metrics.falseNegative).toBeGreaterThan(0);
    return metrics.iou;
  }

  it('Line Art edge pixels match the full image at 2x, and would not without padding', async () => {
    const options = preset('Line Art');
    const { call } = await enhanceCapturing(image, options, box);
    expect(call.options.sourceAutoSketch).toBe(true);
    const frozen = resolveFrozenTraceSourceOptions(image, options);
    const reference = preprocessForTrace(upscaleBy(image, 2), { ...frozen, pixelScale: 2 });
    // The crop is square and the box sits well inside the image, so the
    // padding is the same on every side.
    const offset = (call.image.width - box.width * 2) / 2;
    const padded = preprocessForTrace(call.image, call.options);
    const unpadded = preprocessForTrace(upscaleBy(cropOf(image, box), 2), call.options);
    for (const ring of [4, 16]) {
      expect(ringIou(padded, offset, reference, ring), `padded, ${ring} px ring`).toBe(1);
      // Measured 0.26 (4 px ring) and 0.75 (16 px ring): the control showing
      // that the padding, not the frozen decisions, keeps the edge.
      expect(ringIou(unpadded, 0, reference, ring), `unpadded, ${ring} px ring`).toBeLessThan(0.9);
    }
  });
});

describe('Region Enhance keeps canonical curves, bindings and seams (ADR-410)', () => {
  const region = { x: 50, y: 50, width: 100, height: 100 };
  const interior = { minX: 51, minY: 51, maxX: 149, maxY: 149 };
  const radius = 4;
  // Discs whose edge grazes the interior border from either side, on all
  // four sides, plus a bar crossing the whole box.
  // Left and right discs skip the bar's rows.
  const offsets = [-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75];
  const rows = [62, 74, 86, 114, 126, 138];
  const discs = offsets.flatMap((d, i) => {
    const along = 62 + i * 12;
    const row = rows[i];
    return [
      { x: along + 5, y: interior.minY + radius + d },
      { x: along, y: interior.maxY - radius - d },
      ...(row === undefined
        ? []
        : [
            { x: interior.minX + radius + d, y: row },
            { x: interior.maxX - radius - d, y: row + 3 },
          ]),
    ];
  });
  const outside = [
    { x: 20, y: 20 },
    { x: 180, y: 175 },
  ];
  const image = canvas(200, 200, (x, y) => {
    if (y >= 96 && y < 104 && x >= 10 && x < 190) return grey(0);
    let cover = 0;
    for (const c of [...discs, ...outside]) {
      cover = Math.max(cover, discCoverage(x, y, c.x, c.y, radius));
    }
    return grey(Math.round(255 * (1 - cover)));
  });

  it('carries curves and operationIds through, and each grazing disc stays exactly once', async () => {
    const options = preset('Sharp');
    const frozen = resolveFrozenTraceSourceOptions(image, options);
    const traced = await traceImageToColoredPaths(image, frozen);
    const full = traced.map((path) => ({ ...path, operationIds: ['op-engrave'] }));
    const out = await enhanceRegionPaths({
      image,
      region,
      fullTracePaths: full,
      options,
      trace: (crop, derived) => traceImageToColoredPaths(crop, derived),
    });

    expect(out.map((path) => path.operationIds)).toEqual(full.map((path) => path.operationIds));
    const originals = new Map<Polyline, string>();
    for (const path of full) {
      path.polylines.forEach((pl, i) => originals.set(pl, JSON.stringify(path.curves?.[i])));
    }
    let replaced = 0;
    for (const path of out) {
      expect(path.curves).toHaveLength(path.polylines.length);
      path.polylines.forEach((pl, i) => {
        const curve = path.curves?.[i];
        if (curve === undefined) throw new Error('missing curve');
        const original = originals.get(pl);
        if (original !== undefined) {
          expect(JSON.stringify(curve)).toBe(original);
          return;
        }
        replaced += 1;
        const flat = flattenCurveSubpath(curve, { toleranceMm: 0.01 });
        if (flat.kind !== 'ok') throw new Error('curve did not flatten');
        const ring = pl.closed ? [...pl.points, pl.points[0]!] : pl.points;
        expect(maximumPointDistanceToPolyline(flat.polyline.points, ring)).toBeLessThan(0.5);
      });
    }
    expect(replaced).toBeGreaterThan(0);
    // Every subpath not fully inside the box, on any of its four sides, is the
    // original object.
    const kept = out.flatMap((path) => path.polylines);
    let outsideCount = 0;
    for (const pl of full.flatMap((path) => path.polylines)) {
      const leavesBox = pl.points.some(
        (p) =>
          p.x < region.x ||
          p.y < region.y ||
          p.x > region.x + region.width ||
          p.y > region.y + region.height,
      );
      if (!leavesBox) continue;
      outsideCount += 1;
      expect(kept).toContain(pl);
    }
    // The two outside discs (one right of and below the box) and the bar.
    expect(outsideCount).toBeGreaterThanOrEqual(3);

    const census = (paths: ReadonlyArray<ColoredPath>, c: { x: number; y: number }) =>
      paths
        .flatMap((path) => path.polylines)
        .filter((pl) => pl.closed && pl.points.length > 2)
        .filter((pl) => pl.points.every((p) => Math.hypot(p.x - c.x, p.y - c.y) < radius + 2))
        .length;
    for (const c of [...discs, ...outside]) {
      expect(census(full, c), `full pass at ${c.x},${c.y}`).toBe(1);
      expect(census(out, c), `enhanced at ${c.x},${c.y}`).toBe(1);
    }
    const bars = (paths: ReadonlyArray<ColoredPath>) =>
      paths
        .flatMap((path) => path.polylines)
        .filter((pl) => {
          const xs = pl.points.map((p) => p.x);
          return Math.min(...xs) < 15 && Math.max(...xs) > 185;
        });
    expect(bars(out)).toEqual(bars(full));
    expect(bars(out)).toHaveLength(1);
  });
});

// A dark block and a pale stroke inside the box; either the stroke is gold
// (the only colour) or it is grey and a warm patch far away is the colour.
function paleStrokeArt(x: number, y: number, colourElsewhere: boolean): Rgb {
  const within = (x0: number, x1: number, y0: number, y1: number): boolean =>
    x >= x0 && x < x1 && y >= y0 && y < y1;
  if (within(200, 215, 100, 120)) return grey(20);
  if (within(225, 260, 88, 91)) return colourElsewhere ? grey(175) : [215, 170, 70];
  if (colourElsewhere && within(20, 120, 250, 320)) return [200, 90 + ((x * 7 + y * 3) % 40), 60];
  return grey(255);
}

function cropOf(image: RawImageData, box: TraceBoundary): RawImageData {
  return canvas(box.width, box.height, (x, y) => {
    const o = ((y + box.y) * image.width + x + box.x) * 4;
    return [image.data[o] ?? 255, image.data[o + 1] ?? 255, image.data[o + 2] ?? 255];
  });
}
