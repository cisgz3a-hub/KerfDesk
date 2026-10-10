import { describe, expect, it } from 'vitest';
import { meshToHeightmap } from './mesh-to-heightmap';
import { splitReliefForTwoSides, TWO_SIDED_FRAME_MM } from './relief-two-sided-split';

// ADR-579: a sphere split for two-sided carving. Each side's relief, read the
// way relief CAM reads it, must be the sphere's own top or bottom surface at
// the depth its stock face puts it, down to that side's floor, with the frame
// at the face and the two floors one web apart.

const R = 10;
const STOCK_MM = 30;
const SPLIT_MM = 10;
const WEB_MM = 1;
const MARGIN_MM = 5;

// A UV sphere of radius R centred at (R, R, R), in model units of 0.5 mm, so
// the relief's own 20 mm width and depth are a scale of 2.
function sphere(): number[] {
  const p: number[] = [];
  const at = (u: number, v: number): [number, number, number] => {
    const theta = (u / 128) * 2 * Math.PI;
    const phi = (v / 64) * Math.PI - Math.PI / 2;
    return [
      (R + R * Math.cos(phi) * Math.cos(theta)) / 2,
      (R + R * Math.cos(phi) * Math.sin(theta)) / 2,
      (R + R * Math.sin(phi)) / 2,
    ];
  };
  for (let u = 0; u < 128; u += 1) {
    for (let v = 0; v < 64; v += 1) {
      p.push(...at(u, v), ...at(u + 1, v), ...at(u + 1, v + 1));
      p.push(...at(u, v), ...at(u + 1, v + 1), ...at(u, v + 1));
    }
  }
  return p;
}

function depthAt(positions: Float64Array, widthMm: number, depthMm: number, x: number, y: number) {
  const result = meshToHeightmap(
    { positions },
    { targetWidthMm: widthMm, reliefDepthMm: depthMm, mmPerCell: 0.1 },
  );
  if (result.kind !== 'ok') throw new Error(result.reason);
  const map = result.heightmap;
  const i = Math.floor(x / map.mmPerCell);
  const j = Math.floor(y / map.mmPerCell);
  return map.depth[j * map.widthCells + i] ?? Number.NaN;
}

describe('splitReliefForTwoSides', () => {
  const split = splitReliefForTwoSides(sphere(), 2 * R, 2 * R, {
    splitHeightMm: SPLIT_MM,
    webMm: WEB_MM,
    marginMm: MARGIN_MM,
    stockThicknessMm: STOCK_MM,
  });
  if (split.kind !== 'ok') throw new Error(split.reason);
  const inset = MARGIN_MM + TWO_SIDED_FRAME_MM;
  // The model sits centred in the stock: 5 mm of stock above and below it.
  const gap = (STOCK_MM - 2 * R) / 2;
  const radial = (x: number, y: number): number => Math.hypot(x - inset - R, y - inset - R);

  it('frames both sides at the model inset, with the floors one web apart', () => {
    expect(split.insetMm).toBe(inset);
    expect(split.fitsStock).toBe(true);
    expect(split.sideA.widthMm).toBeCloseTo(2 * R + 2 * inset, 12);
    expect(split.sideA.depthMm).toBeCloseTo(gap + 2 * R - SPLIT_MM, 12);
    expect(split.sideB.depthMm).toBeCloseTo(gap + SPLIT_MM - WEB_MM, 12);
    expect(split.sideA.depthMm + split.sideB.depthMm).toBeCloseTo(STOCK_MM - WEB_MM, 12);
  });

  it('side A is the top of the sphere below its stock face, floored at the split', () => {
    const { positions, widthMm, depthMm } = split.sideA;
    for (const [x, y] of [
      [inset + R, inset + R],
      [inset + R + 6, inset + R - 3],
      [inset + 2, inset + 2],
    ] as const) {
      const r = radial(x, y);
      const top = r < R ? R + Math.sqrt(R * R - r * r) : 0;
      const expected = Math.max(top, SPLIT_MM) - (2 * R + gap);
      expect(depthAt(positions, widthMm, depthMm, x, y)).toBeCloseTo(expected, 1);
    }
    expect(depthAt(positions, widthMm, depthMm, 0.5, 0.5)).toBeCloseTo(0, 6);
  });

  it('side B is the bottom of the sphere, seen from below, floored at the web', () => {
    const { positions, widthMm, depthMm } = split.sideB;
    for (const [x, y] of [
      [inset + R, inset + R],
      [inset + R - 5, inset + R + 4],
      [inset + 2, inset + 2],
    ] as const) {
      const r = radial(x, y);
      const bottom = r < R ? R - Math.sqrt(R * R - r * r) : Number.POSITIVE_INFINITY;
      // Height above the bottom face, measured downward from it on side B.
      const expected = -(gap + Math.min(bottom, SPLIT_MM - WEB_MM));
      expect(depthAt(positions, widthMm, depthMm, x, y)).toBeCloseTo(expected, 1);
    }
    expect(depthAt(positions, widthMm, depthMm, 0.5, 0.5)).toBeCloseTo(0, 6);
  });

  it('plans for stock as thick as the model when the stock is thinner, and says so', () => {
    const thin = splitReliefForTwoSides(sphere(), 2 * R, 2 * R, {
      splitHeightMm: SPLIT_MM,
      webMm: 0,
      marginMm: MARGIN_MM,
      stockThicknessMm: 12,
    });
    if (thin.kind !== 'ok') throw new Error(thin.reason);
    expect(thin.fitsStock).toBe(false);
    expect(thin.stockThicknessMm).toBe(2 * R);
    expect(thin.sideA.depthMm + thin.sideB.depthMm).toBeCloseTo(2 * R, 12);
  });

  it('refuses a split outside the model or a web at or above it', () => {
    const options = { webMm: WEB_MM, marginMm: MARGIN_MM, stockThicknessMm: STOCK_MM };
    expect(splitReliefForTwoSides(sphere(), 20, 20, { ...options, splitHeightMm: 0 }).kind).toBe(
      'error',
    );
    expect(splitReliefForTwoSides(sphere(), 20, 20, { ...options, splitHeightMm: 20 }).kind).toBe(
      'error',
    );
    expect(
      splitReliefForTwoSides(sphere(), 20, 20, { ...options, splitHeightMm: 1, webMm: 1 }).kind,
    ).toBe('error');
  });
});
