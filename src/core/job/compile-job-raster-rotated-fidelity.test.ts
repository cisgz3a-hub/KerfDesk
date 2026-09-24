// Rotated images reach the burn grid the way upright ones do (ADR-359):
// Threshold keeps a centre sample; the tone-rendering modes read each cell's
// area mean, exactly on a quarter turn and bilinearly between reduced cells at
// other angles; a source no denser than the grid, and Pass-Through, read the
// source untouched.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { pixelExtentForMm } from '../raster';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type DitherAlgorithm,
  type RasterImage,
  type Transform,
} from '../scene';
import { compileRasterGroupsForLayer } from './compile-job-raster';
import type { RasterGroup } from './job';
import { rasterBoundsInMachineCoords } from './raster-bounds';
import { prepareRotatedRaster, rotatedMaskedRasterLuma } from './raster-rotated-sample';

const DEVICE = DEFAULT_DEVICE_PROFILE;
const LINES_PER_MM = 10;

type ImageOptions = {
  readonly widthMm?: number;
  readonly heightMm?: number;
  readonly transform?: Partial<Transform>;
};

function image(
  pxPerMm: number,
  luma: (x: number, y: number) => number,
  rotationDeg: number,
  options: ImageOptions = {},
): RasterImage {
  const width = Math.round((options.widthMm ?? 30) * pxPerMm);
  const height = Math.round((options.heightMm ?? 3) * pxPerMm);
  const bytes = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) bytes[y * width + x] = luma(x, y);
  }
  return {
    kind: 'raster-image',
    id: 'art',
    source: 'art.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: width,
    pixelHeight: height,
    bounds: { minX: 0, minY: 0, maxX: width / pxPerMm, maxY: height / pxPerMm },
    transform: { ...IDENTITY_TRANSFORM, x: 60, y: 60, rotationDeg, ...options.transform },
    color: '#808080',
    dither: 'threshold',
    linesPerMm: LINES_PER_MM,
    lumaBase64: Buffer.from(bytes).toString('base64'),
  };
}

// Columns carrying a 1 px line at an irregular 11-14 px pitch.
function lineColumns(width: number): ReadonlySet<number> {
  const columns = new Set<number>();
  for (let at = 3, i = 0; at < width - 2; i += 1) {
    columns.add(at);
    at += 11 + (i % 4);
  }
  return columns;
}

function darkStrokes(pxPerMm: number, rotationDeg: number): RasterImage {
  const columns = lineColumns(Math.round(30 * pxPerMm));
  return image(pxPerMm, (x) => (columns.has(x) ? 0 : 255), rotationDeg);
}

function whiteLines(pxPerMm: number, rotationDeg: number, options?: ImageOptions): RasterImage {
  const columns = lineColumns(Math.round((options?.widthMm ?? 30) * pxPerMm));
  return image(pxPerMm, (x) => (columns.has(x) ? 255 : 0), rotationDeg, options);
}

function compile(obj: RasterImage, ditherAlgorithm: DitherAlgorithm): RasterGroup {
  const layer = {
    ...createLayer({ id: 'image', color: '#808080', mode: 'image' as const }),
    ditherAlgorithm,
    linesPerMm: LINES_PER_MM,
  };
  const group = compileRasterGroupsForLayer([obj], layer, DEVICE).groups[0];
  if (group === undefined) throw new Error('expected a raster group');
  return group;
}

function burnedCells(group: RasterGroup): number {
  let burned = 0;
  for (const s of group.sValues) if (s > 0) burned += 1;
  return burned;
}

// Grid rows (or columns) that carry at least 10 % white under grayscale,
// where power maps straight from the sampled luma.
function linesWithWhite(group: RasterGroup, alongRows: boolean): number {
  const sMax = Math.max(...group.sValues);
  const outer = alongRows ? group.pixelHeight : group.pixelWidth;
  const inner = alongRows ? group.pixelWidth : group.pixelHeight;
  let count = 0;
  for (let a = 0; a < outer; a += 1) {
    let power = 0;
    for (let b = 0; b < inner; b += 1) {
      const index = alongRows ? a * group.pixelWidth + b : b * group.pixelWidth + a;
      power += group.sValues[index] ?? sMax;
    }
    if (1 - power / (sMax * inner) >= 0.1) count += 1;
  }
  return count;
}

function prepared(obj: RasterImage, passThrough = false) {
  const bounds = rasterBoundsInMachineCoords(obj, DEVICE);
  return prepareRotatedRaster(
    {
      sourceLuma: Buffer.from(obj.lumaBase64 ?? '', 'base64'),
      obj,
      device: DEVICE,
      bounds,
      pixelWidth: pixelExtentForMm(bounds.maxX - bounds.minX, LINES_PER_MM),
      pixelHeight: pixelExtentForMm(bounds.maxY - bounds.minY, LINES_PER_MM),
      kernel: 'area',
      passThrough,
    },
    null,
  );
}

describe('rotated image burn fidelity', () => {
  it('keeps thin Threshold strokes at every quarter turn, as the unrotated burn does', () => {
    for (const pxPerMm of [11.811, 15]) {
      const upright = burnedCells(compile(darkStrokes(pxPerMm, 0), 'threshold'));
      expect(upright, `${pxPerMm} px/mm upright`).toBeGreaterThan(0);
      for (const turn of [90, 180, 270]) {
        const rotated = burnedCells(compile(darkStrokes(pxPerMm, turn), 'threshold'));
        expect(rotated, `${pxPerMm} px/mm at ${turn} deg`).toBeGreaterThanOrEqual(0.9 * upright);
      }
    }
  });

  it('never averages a Threshold image, which would erase every sub-half-cell stroke', () => {
    // A 1 px stroke is a quarter or half of a cell here: averaged, its cell
    // reads 191 or 128 and never passes the < 128 cut. At these exact ratios
    // every cell centre sits on a pixel boundary, so upright and rotated pick
    // different (equally near) phases; both must still burn strokes.
    for (const pxPerMm of [20, 40]) {
      for (const turn of [0, 90]) {
        const burned = burnedCells(compile(darkStrokes(pxPerMm, turn), 'threshold'));
        expect(burned, `${pxPerMm} px/mm at ${turn} deg`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps every sub-cell white line on a quarter turn at non-integer densities', () => {
    for (const pxPerMm of [11.811, 15, 19, 25, 35]) {
      const lines = lineColumns(Math.round(30 * pxPerMm)).size;
      const upright = compile(whiteLines(pxPerMm, 0), 'grayscale');
      expect(linesWithWhite(upright, false), `${pxPerMm} px/mm upright`).toBeGreaterThanOrEqual(
        lines,
      );
      for (const turn of [90, 270]) {
        const rotated = compile(whiteLines(pxPerMm, turn), 'grayscale');
        expect(
          linesWithWhite(rotated, true),
          `${pxPerMm} px/mm at ${turn} deg`,
        ).toBeGreaterThanOrEqual(lines);
      }
    }
  });

  it('keeps sub-cell white lines on a quarter turn of a non-uniformly scaled image', () => {
    // Local 20 px/mm squeezed to 40 px/mm across the lines and stretched to
    // 10 px/mm along them.
    const art = whiteLines(20, 90, { transform: { scaleX: 0.5, scaleY: 2 } });
    const lines = lineColumns(art.pixelWidth).size;
    expect(linesWithWhite(compile(art, 'grayscale'), true)).toBeGreaterThanOrEqual(lines);
  });

  it('reads the source untouched when it is no denser than the grid, or burns as Pass-Through', () => {
    const oneToOne = image(10, () => 128, 30);
    expect(prepared(oneToOne).sampleLuma.length).toBe(oneToOne.pixelWidth * oneToOne.pixelHeight);
    for (const turn of [30, 45, 90]) {
      for (const transform of [{}, { scaleX: 0.5, scaleY: 2 }]) {
        const art = whiteLines(40, turn, { transform });
        const source = prepared(art, true);
        expect([source.sampleWidth, source.sampleHeight], `Pass-Through @${turn}`).toEqual([
          art.pixelWidth,
          art.pixelHeight,
        ]);
      }
    }
  });

  it('reduces a dense source to the burn-cell pitch before sampling it', () => {
    const quarter = prepared(whiteLines(40, 90));
    expect([quarter.sampleWidth, quarter.sampleHeight, quarter.sampling]).toEqual([
      300,
      30,
      'centre',
    ]);
    const angled = prepared(whiteLines(25, 30));
    expect(angled.sampling).toBe('bilinear');
    expect(angled.sampleWidth).toBeLessThan(Math.round(30 * 25));
  });

  it('keeps a flat tone flat inside a rotated footprint', () => {
    const art = image(40, () => 100, 30, { widthMm: 20, heightMm: 12 });
    const luma = rotatedMaskedRasterLuma(prepared(art), null);
    const inked = [...luma].filter((value) => value !== 255);
    // Only cells straddling the footprint edge blend toward the white padding.
    expect(Math.min(...inked)).toBe(100);
    expect(inked.filter((value) => value === 100).length / inked.length).toBeGreaterThan(0.9);
  });
});
