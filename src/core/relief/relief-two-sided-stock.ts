// A side of a two-sided split follows the current stock (ADR-580 Amendment 1).
//
// The split centres the model of height D in stock T: the stock's faces sit at
// model heights (D − T)/2 and (D + T)/2, side A carves from the top face down
// to the split and side B from the bottom face up to the split less the web.
// For another stock the side is re-planned from its own mesh and that record:
// its frame moves to the new face, the model is cut down to the face where it
// rises above it, and the two floors stay the web apart, so together the sides
// cut T − web. Where stock thinner than the model would leave the web outside
// it, the split moves just far enough to keep the web inside the stock; one
// side then has nothing to carve. A negative web is never planned.

import type { ReliefTwoSidedSplitRecord } from '../scene/relief/relief-two-sided-split';
import type { MeshReliefObject } from '../scene/scene-object';
import { refitReliefSideMesh, type ReliefSideLevels } from './relief-two-sided-split';

export type ReliefSideForStock =
  /** Not a recorded side, or a side already planned for this stock. */
  | { readonly kind: 'as-stored'; readonly relief: MeshReliefObject }
  | {
      readonly kind: 'refit';
      readonly relief: MeshReliefObject;
      /** The model is thicker than the stock, so the stock faces cut it down. */
      readonly capped: boolean;
    }
  /** No stock lies on this side of the split and the web. */
  | { readonly kind: 'no-stock' }
  /** A recorded side whose mesh lost its floor and frame, or whose depth was rescaled. */
  | { readonly kind: 'unrecognised'; readonly relief: MeshReliefObject };

const SAME_MM = 1e-9;

const refits = new WeakMap<
  MeshReliefObject,
  { readonly stockThicknessMm: number; readonly result: ReliefSideForStock }
>();

/** The side relief relief CAM carves from stock `stockThicknessMm` thick. */
export function reliefSideForStock(
  relief: MeshReliefObject,
  stockThicknessMm: number,
): ReliefSideForStock {
  if (
    relief.twoSidedSplit === undefined ||
    !(stockThicknessMm > 0) ||
    !Number.isFinite(stockThicknessMm)
  ) {
    return { kind: 'as-stored', relief };
  }
  const cached = refits.get(relief);
  if (cached?.stockThicknessMm === stockThicknessMm) return cached.result;
  const result = refit(relief, relief.twoSidedSplit, stockThicknessMm);
  refits.set(relief, { stockThicknessMm, result });
  return result;
}

/**
 * Where the split puts a side's stock face and floor for stock `stockMm`, in
 * the side's mesh frame: model heights for side A, their negatives for B.
 */
export function twoSidedSideLevels(
  record: ReliefTwoSidedSplitRecord,
  stockMm: number,
): ReliefSideLevels {
  const depth = record.modelDepthMm;
  const above = (stockMm - depth) / 2;
  const below = stockMm - depth - above;
  const top = depth + above;
  // The web keeps inside the stock, even where the stock is thinner than the model.
  const split = Math.min(Math.max(record.splitHeightMm, record.webMm - below), top);
  return record.side === 'A'
    ? { faceZ: top, floorZ: split }
    : { faceZ: below, floorZ: record.webMm - split };
}

function refit(
  relief: MeshReliefObject,
  record: ReliefTwoSidedSplitRecord,
  stockMm: number,
): ReliefSideForStock {
  const capped = stockMm < record.modelDepthMm - SAME_MM;
  if (!capped && Math.abs(stockMm - record.stockThicknessMm) <= SAME_MM) {
    return { kind: 'as-stored', relief };
  }
  const positions = relief.reliefSource.meshPositions;
  // Relief CAM scales the mesh's height to the relief depth. The split made
  // them equal; a side whose depth was edited since no longer matches its stock.
  const zExtent = meshZExtent(positions);
  if (!(Math.abs(relief.reliefDepthMm - zExtent) <= 1e-6 * Math.max(1, zExtent))) {
    return { kind: 'unrecognised', relief };
  }
  const side = refitReliefSideMesh(positions, twoSidedSideLevels(record, stockMm));
  if (side.kind === 'no-stock') return side;
  if (side.kind === 'unrecognised') return { kind: 'unrecognised', relief };
  return {
    kind: 'refit',
    capped,
    relief: {
      ...relief,
      reliefDepthMm: side.depthMm,
      reliefSource: { ...relief.reliefSource, meshPositions: side.positions },
    },
  };
}

function meshZExtent(positions: ArrayLike<number>): number {
  let min = Infinity;
  let max = -Infinity;
  for (let at = 2; at < positions.length; at += 3) {
    const z = positions[at] ?? 0;
    min = Math.min(min, z);
    max = Math.max(max, z);
  }
  return max - min;
}
