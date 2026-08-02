import { describe, expect, it } from 'vitest';
import { maskRaster, randomMaskCase, type MaskCase } from '../../__fixtures__/mask-parity-cases';
import {
  referencePixelCenterInScene,
  referencePointInEvenOdd,
  type OracleContours,
} from '../../__fixtures__/mask-parity-oracle';
import { maskShape } from '../../__fixtures__/mask-shape';
import { applyTransform, IDENTITY_TRANSFORM, type SceneObject, type Vec2 } from '../scene';
import { createImageMaskPixelTest } from './image-mask';

const PROPERTY_CASES = 320;
// Coverage floors, so a generator change can never quietly reduce this to a
// test of the fallback path (or to a test where nothing is inside the mask).
const MIN_SCANLINE_ROWS = 500;
const MIN_PER_PIXEL_ROWS = 200;
const MIN_INSIDE_RATIO = 0.1;
const MAX_INSIDE_RATIO = 0.9;

// Mulberry32. The pure core bans randomness, but a test needs varied input and
// a fixed seed keeps it reproducible - a failure is always re-runnable.
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Mirrors closedMaskContours: contour points in scene space.
function sceneContours(maskCase: MaskCase): OracleContours {
  return maskCase.points.map((contour) =>
    contour.map((point) => applyTransform(point, maskCase.maskTransform)),
  );
}

function maskObjectFor(maskCase: MaskCase): SceneObject {
  return {
    ...maskShape('M1', maskCase.points[0] ?? [], maskCase.maskTransform),
    paths: [
      {
        color: '#000000',
        polylines: maskCase.points.map((points) => ({ points, closed: true })),
      },
    ],
  };
}

// A row is a scene-space scan line only when its pixel centers share one scene
// y — the condition under which one crossing list can serve the whole row.
// Rows that fail it fall back to the per-pixel test, and both must be covered.
function isScanlineRow(maskCase: MaskCase, y: number): boolean {
  const { image, width, height } = maskCase;
  return (
    referencePixelCenterInScene(image, 0, y, width, height).y ===
    referencePixelCenterInScene(image, width - 1, y, width, height).y
  );
}

type CaseResult = {
  readonly mismatches: ReadonlyArray<string>;
  readonly scanlineRows: number;
  readonly perPixelRows: number;
  readonly insidePixels: number;
  readonly pixels: number;
};

const EMPTY_COVERAGE = {
  scanlineRows: 0,
  perPixelRows: 0,
  insidePixels: 0,
  pixels: 0,
} as const;

function evaluateCase(maskCase: MaskCase): CaseResult {
  const { image, width, height } = maskCase;
  const test = createImageMaskPixelTest(image, maskObjectFor(maskCase), width, height);
  if (test === null) return { mismatches: ['no mask test was created'], ...EMPTY_COVERAGE };
  const contours = sceneContours(maskCase);
  const mismatches: string[] = [];
  let scanlineRows = 0;
  let insidePixels = 0;
  for (let y = 0; y < height; y += 1) {
    if (isScanlineRow(maskCase, y)) scanlineRows += 1;
    for (let x = 0; x < width; x += 1) {
      const expected = referencePointInEvenOdd(
        referencePixelCenterInScene(image, x, y, width, height),
        contours,
      );
      if (expected) insidePixels += 1;
      if (test(x, y) !== expected) mismatches.push(`(${x},${y}) expected ${String(expected)}`);
    }
  }
  return {
    mismatches,
    scanlineRows,
    perPixelRows: height - scanlineRows,
    insidePixels,
    pixels: width * height,
  };
}

function fixedCase(points: ReadonlyArray<ReadonlyArray<Vec2>>): MaskCase {
  return {
    image: maskRaster({ minX: 0, minY: 0, maxX: 4, maxY: 4 }, IDENTITY_TRANSFORM),
    points,
    maskTransform: IDENTITY_TRANSFORM,
    width: 4,
    height: 4,
  };
}

describe('mask scanline — even-odd parity with the per-pixel test', () => {
  it('matches the per-pixel oracle on every pixel of every random case', () => {
    const random = seededRandom(20_260_802);
    const failures: string[] = [];
    let scanlineRows = 0;
    let perPixelRows = 0;
    let insidePixels = 0;
    let pixels = 0;
    for (let caseIndex = 0; caseIndex < PROPERTY_CASES; caseIndex += 1) {
      const result = evaluateCase(randomMaskCase(random));
      if (result.mismatches.length > 0) {
        failures.push(`case ${caseIndex}: ${result.mismatches.join('; ')}`);
      }
      scanlineRows += result.scanlineRows;
      perPixelRows += result.perPixelRows;
      insidePixels += result.insidePixels;
      pixels += result.pixels;
    }
    expect(failures).toEqual([]);
    expect(scanlineRows).toBeGreaterThanOrEqual(MIN_SCANLINE_ROWS);
    expect(perPixelRows).toBeGreaterThanOrEqual(MIN_PER_PIXEL_ROWS);
    expect(insidePixels / pixels).toBeGreaterThan(MIN_INSIDE_RATIO);
    expect(insidePixels / pixels).toBeLessThan(MAX_INSIDE_RATIO);
  });

  it('agrees on pixel centers that sit exactly on edges and vertices', () => {
    // Bounds 0..4 over a 4-wide grid put pixel centers exactly at 0.5, 1.5,
    // 2.5, 3.5 — the square's edges and corners land on them.
    const square = [
      { x: 0.5, y: 0.5 },
      { x: 2.5, y: 0.5 },
      { x: 2.5, y: 2.5 },
      { x: 0.5, y: 2.5 },
    ];
    expect(evaluateCase(fixedCase([square])).mismatches).toEqual([]);
  });

  it('agrees on a contour carrying a non-finite vertex', () => {
    // A NaN vertex makes the crossing NaN, which the per-pixel test silently
    // never counted (`point.x < NaN` is false). It also leaves an ODD number
    // of crossings on the row, so the parity has to be read from the side the
    // per-pixel toggle counted from.
    const withNaN = [
      { x: 0.5, y: 0.5 },
      { x: 3.5, y: 0.5 },
      { x: Number.NaN, y: 2.5 },
      { x: 3.5, y: 3.5 },
      { x: 0.5, y: 3.5 },
    ];
    expect(evaluateCase(fixedCase([withNaN])).mismatches).toEqual([]);
  });

  it('agrees when the grid extends far outside the contour', () => {
    const maskCase: MaskCase = {
      image: maskRaster({ minX: -20, minY: -20, maxX: 20, maxY: 20 }, IDENTITY_TRANSFORM),
      points: [
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
      ],
      maskTransform: IDENTITY_TRANSFORM,
      width: 8,
      height: 8,
    };
    expect(evaluateCase(maskCase).mismatches).toEqual([]);
  });
});
