import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM } from '../scene';
import type { MeshReliefObject } from '../scene/relief';
import { meshToHeightmap } from './mesh-to-heightmap';
import {
  refitReliefSideMesh,
  splitReliefForTwoSides,
  TWO_SIDED_FRAME_MM,
  type ReliefTwoSidedOptions,
} from './relief-two-sided-split';
import { reliefSideForStock } from './relief-two-sided-stock';

// ADR-580 Amendment 1 (audit F6-P1-1): a split side follows the current stock.
// A side planned for one stock thickness and refit for another must be the side
// a split on that other stock gives, and the two floors must stay the split's
// web apart whatever the stock, never crossing.

const R = 10;
const D = 2 * R;
const SPLIT_MM = 10;
const WEB_MM = 1;
const MARGIN_MM = 5;
const INSET = MARGIN_MM + TWO_SIDED_FRAME_MM;

// A UV sphere of radius R standing on z = 0, in millimetres.
function sphere(): number[] {
  const p: number[] = [];
  const at = (u: number, v: number): [number, number, number] => {
    const theta = (u / 64) * 2 * Math.PI;
    const phi = (v / 32) * Math.PI - Math.PI / 2;
    return [
      R + R * Math.cos(phi) * Math.cos(theta),
      R + R * Math.cos(phi) * Math.sin(theta),
      R + R * Math.sin(phi),
    ];
  };
  for (let u = 0; u < 64; u += 1) {
    for (let v = 0; v < 32; v += 1) {
      p.push(...at(u, v), ...at(u + 1, v), ...at(u + 1, v + 1));
      p.push(...at(u, v), ...at(u + 1, v + 1), ...at(u, v + 1));
    }
  }
  return p;
}

const SPHERE = sphere();

function sides(stockThicknessMm: number, options: Partial<ReliefTwoSidedOptions> = {}) {
  const split = splitReliefForTwoSides(SPHERE, D, D, {
    splitHeightMm: SPLIT_MM,
    webMm: WEB_MM,
    marginMm: MARGIN_MM,
    stockThicknessMm,
    ...options,
  });
  if (split.kind !== 'ok') throw new Error(split.reason);
  const relief = (side: 'A' | 'B'): MeshReliefObject => {
    const mesh = side === 'A' ? split.sideA : split.sideB;
    return {
      kind: 'relief',
      id: side,
      source: `sphere.stl (side ${side})`,
      reliefSource: { kind: 'legacy-mesh', meshPositions: mesh.positions, emptyCells: 'floor' },
      targetWidthMm: mesh.widthMm,
      reliefDepthMm: mesh.depthMm,
      color: '#a0522d',
      bounds: { minX: 0, minY: 0, maxX: mesh.widthMm, maxY: mesh.heightMm },
      transform: IDENTITY_TRANSFORM,
      twoSidedSplit: {
        side,
        stockThicknessMm: split.stockThicknessMm,
        modelDepthMm: D,
        splitHeightMm: options.splitHeightMm ?? SPLIT_MM,
        webMm: options.webMm ?? WEB_MM,
      },
    };
  };
  return { A: relief('A'), B: relief('B') };
}

function refit(relief: MeshReliefObject, stockMm: number): MeshReliefObject {
  const side = reliefSideForStock(relief, stockMm);
  if (side.kind === 'no-stock') throw new Error('no stock');
  return side.relief;
}

// The relief's depth below its stock face at (x, y), as relief CAM reads it.
function depthAt(relief: MeshReliefObject, x: number, y: number): number {
  const result = meshToHeightmap(
    { positions: Float64Array.from(relief.reliefSource.meshPositions) },
    { targetWidthMm: relief.targetWidthMm, reliefDepthMm: relief.reliefDepthMm, mmPerCell: 0.1 },
  );
  if (result.kind !== 'ok') throw new Error(result.reason);
  const map = result.heightmap;
  const i = Math.floor(x / map.mmPerCell);
  const j = Math.floor(y / map.mmPerCell);
  return map.depth[j * map.widthCells + i] ?? Number.NaN;
}

const CENTRE = INSET + R;
const PROBES: ReadonlyArray<readonly [number, number]> = [
  [CENTRE, CENTRE],
  [CENTRE + 6, CENTRE - 3],
  [CENTRE - 8, CENTRE + 5],
  [INSET + 1, INSET + 1],
  [0.5, 0.5],
];

describe('reliefSideForStock', () => {
  it('keeps a side split on the current stock exactly as stored', () => {
    const { A, B } = sides(30);
    for (const side of [A, B]) {
      const fit = reliefSideForStock(side, 30);
      expect(fit.kind).toBe('as-stored');
      expect(fit.kind !== 'no-stock' && fit.relief).toBe(side);
    }
    expect(A.reliefDepthMm + B.reliefDepthMm).toBeCloseTo(30 - WEB_MM, 12);
  });

  it.each([
    ['thicker', 30, 40],
    ['thinner but above the model', 30, 22.5],
    ['planned on stock thinner than the model, then the real board', 12, 30],
  ])(
    'refits a side split on other stock (%s) to the side a split on this stock gives',
    (_, from, to) => {
      const stored = sides(from);
      const fresh = sides(to);
      for (const name of ['A', 'B'] as const) {
        const side = refit(stored[name], to);
        expect(side.reliefDepthMm).toBeCloseTo(fresh[name].reliefDepthMm, 9);
        for (const [x, y] of PROBES) {
          expect(depthAt(side, x, y)).toBeCloseTo(depthAt(fresh[name], x, y), 6);
        }
      }
      const a = refit(stored.A, to).reliefDepthMm;
      const b = refit(stored.B, to).reliefDepthMm;
      expect(a + b).toBeCloseTo(to - WEB_MM, 9);
    },
  );

  it('caps the model at both stock faces when the stock is thinner than it, keeping the web', () => {
    const stock = 16;
    const { A, B } = sides(30);
    const fit = reliefSideForStock(A, stock);
    expect(fit.kind === 'refit' && fit.capped).toBe(true);
    const a = refit(A, stock);
    const b = refit(B, stock);
    // Faces at (T ± D)/2 about the model's middle: 2 mm off each of its poles.
    expect(a.reliefDepthMm).toBeCloseTo((stock + D) / 2 - SPLIT_MM, 9);
    expect(b.reliefDepthMm).toBeCloseTo((stock - D) / 2 + SPLIT_MM - WEB_MM, 9);
    expect(a.reliefDepthMm + b.reliefDepthMm).toBeCloseTo(stock - WEB_MM, 9);
    // The pole is cut flat at the face; lower down the sphere is untouched.
    expect(depthAt(a, CENTRE, CENTRE)).toBeCloseTo(0, 6);
    expect(depthAt(b, CENTRE, CENTRE)).toBeCloseTo(0, 6);
    const x = (Math.floor((CENTRE + 7.5) / 0.1) + 0.5) * 0.1;
    const r = x - CENTRE;
    const top = R + Math.sqrt(R * R - r * r);
    expect(depthAt(a, x, CENTRE)).toBeCloseTo(top - (stock + D) / 2, 1);
  });

  it('keeps the web inside stock that lies wholly under the split', () => {
    const { A, B } = sides(30, { splitHeightMm: 16 });
    // Stock 8 centred on a 20 mm model spans z 6..14, all under the 16 mm
    // split: side A has nothing, and side B stops the web under the top face
    // instead of cutting through it to z 15.
    expect(reliefSideForStock(A, 8).kind).toBe('no-stock');
    expect(refit(B, 8).reliefDepthMm).toBeCloseTo(8 - WEB_MM, 9);
  });

  it('keeps the web inside stock that lies wholly over a low split', () => {
    const { A, B } = sides(30, { splitHeightMm: 3 });
    // Stock 10 spans z 5..15: a floor at the 3 mm split would cut 2 mm under
    // the stock's bottom face. Side A stops 1 mm above it; side B has nothing.
    const a = refit(A, 10);
    expect(a.reliefDepthMm).toBeCloseTo(10 - WEB_MM, 9);
    expect(depthAt(a, INSET + 1, INSET + 1)).toBeCloseTo(-(10 - WEB_MM), 6);
    expect(depthAt(a, 0.5, 0.5)).toBeCloseTo(0, 6);
    expect(reliefSideForStock(B, 10).kind).toBe('no-stock');
  });

  it('never cuts the two floors closer than the web, for any stock', () => {
    for (const splitHeightMm of [3, 10, 16]) {
      const { A, B } = sides(30, { splitHeightMm });
      for (const stock of [1.5, 4, 8, 12, 19, 20, 26, 40]) {
        const depth = (side: MeshReliefObject): number => {
          const fit = reliefSideForStock(side, stock);
          return fit.kind === 'no-stock' ? 0 : fit.relief.reliefDepthMm;
        };
        expect(stock - depth(A) - depth(B)).toBeGreaterThanOrEqual(WEB_MM - 1e-9);
      }
    }
  });

  it('leaves a side that is not a split side, or whose mesh lost its frame, as it is', () => {
    const { A } = sides(30);
    const { twoSidedSplit: _record, ...plain } = A;
    expect(reliefSideForStock(plain, 40)).toEqual({ kind: 'as-stored', relief: plain });
    const mesh = Array.from(A.reliefSource.meshPositions).slice(0, -9);
    const broken = { ...A, reliefSource: { ...A.reliefSource, meshPositions: mesh } };
    expect(reliefSideForStock(broken, 40).kind).toBe('unrecognised');
    // A side whose depth was rescaled after the split no longer matches its stock.
    expect(reliefSideForStock({ ...A, reliefDepthMm: A.reliefDepthMm * 2 }, 40).kind).toBe(
      'unrecognised',
    );
  });

  it('returns the same refit for the same stock', () => {
    const { A } = sides(30);
    expect(reliefSideForStock(A, 40)).toBe(reliefSideForStock(A, 40));
  });
});

describe('refitReliefSideMesh', () => {
  // Side A on 30 mm stock: its face is at 25 mm, its floor at the 10 mm split.
  const FACE = 25;

  it('moves only the frame when the face stays above the model', () => {
    const { A } = sides(30);
    const positions = Float64Array.from(A.reliefSource.meshPositions);
    const fit = refitReliefSideMesh(positions, { faceZ: FACE + 2, floorZ: SPLIT_MM });
    if (fit.kind !== 'ok') throw new Error(fit.kind);
    expect(fit.positions.length).toBe(positions.length);
    const frameStart = positions.length - 72;
    for (let at = 0; at < positions.length; at += 1) {
      const isFrameZ = at >= frameStart && at % 3 === 2;
      expect(fit.positions[at]).toBe((positions[at] ?? 0) + (isFrameZ ? 2 : 0));
    }
    expect(fit.depthMm).toBeCloseTo(A.reliefDepthMm + 2, 12);
  });

  it('clips the model at a raised floor', () => {
    const { A } = sides(30);
    const fit = refitReliefSideMesh(A.reliefSource.meshPositions, { faceZ: FACE, floorZ: 15 });
    if (fit.kind !== 'ok') throw new Error(fit.kind);
    let lowest = Infinity;
    for (let at = 2; at < fit.positions.length; at += 3) {
      lowest = Math.min(lowest, fit.positions[at] ?? 0);
    }
    expect(lowest).toBe(15);
    expect(fit.depthMm).toBe(FACE - 15);
  });

  it('refuses to lower the floor, and reports a face at or below it as no stock', () => {
    const positions = sides(30).A.reliefSource.meshPositions;
    expect(refitReliefSideMesh(positions, { faceZ: FACE, floorZ: SPLIT_MM - 1 }).kind).toBe(
      'unrecognised',
    );
    expect(refitReliefSideMesh(positions, { faceZ: SPLIT_MM, floorZ: SPLIT_MM }).kind).toBe(
      'no-stock',
    );
  });
});
