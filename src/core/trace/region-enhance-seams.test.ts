// ADR-410: Region Enhance patches must binarise and join like the full pass.
import { describe, expect, it } from 'vitest';
import { compareMasks } from '../../__fixtures__/perceptual/compare';
import { maximumPointDistanceToPolyline } from '../../__fixtures__/polyline-distance';
import { flattenCurveSubpath, type ColoredPath, type Polyline } from '../scene';
import { shouldUseSketchTrace } from './auto-sketch-trace';
import { upscaleBy } from './auto-upscale';
import { otsuThreshold } from './preprocess';
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
    // Outside the box every subpath is the original object.
    for (const pl of full.flatMap((path) => path.polylines)) {
      if (pl.points.some((p) => p.x < region.x || p.y < region.y)) {
        expect(out.flatMap((path) => path.polylines)).toContain(pl);
      }
    }

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
