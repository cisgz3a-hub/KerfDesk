// Splitting an STL relief for two-sided carving (ADR-580).
//
// A 3-axis router reaches a model from one side only, so a fully 3D part is
// carved in two setups: side A from the top, then the stock is flipped and
// side B carves the bottom (ADR-573 flips side B's placement before CAM). This
// turns one STL relief into the two relief meshes those setups cut:
//
// - Side A is the model seen from above, down to the split plane. A base plate
//   at the split plane is the floor side A carves the background to.
// - Side B is the model seen from below, in the same top-view frame (the side
//   setup mirrors it), down to the split plane less the holding web, so a web
//   of that thickness keeps the part in the stock until it is cut free.
// - Both carry a frame of stock-face height round the outside. A relief maps
//   its highest point to the stock top, so the frame fixes each side's Z datum
//   at its stock face: a model thinner than the stock sits centred in it, and
//   each side carves away the stock between its face and the model.
//
// Everything is in millimetres in the relief's own frame (x right, y down as
// stored, z up). The model keeps the relief's placed width and depth.
//
// A side mesh is the clipped model, then the floor plate (2 triangles), then
// the frame (8 triangles). refitReliefSideMesh reads that layout back to move
// the frame and floor for another stock (ADR-580 Amendment 1).

import { meshBounds, FLOATS_PER_TRIANGLE } from './triangle-mesh';

/** Width of the stock-face frame round each side. */
export const TWO_SIDED_FRAME_MM = 1;

const FLOOR_FLOATS = 2 * FLOATS_PER_TRIANGLE;
const FRAME_FLOATS = 8 * FLOATS_PER_TRIANGLE;

export type ReliefTwoSidedOptions = {
  /** Split plane height above the model's lowest point, in mm. */
  readonly splitHeightMm: number;
  /** Holding web left between the two floors, in mm (0 = none). */
  readonly webMm: number;
  /** Clear margin round the model inside the frame, in mm. */
  readonly marginMm: number;
  /** Stock thickness, or undefined to take the model's own height. */
  readonly stockThicknessMm?: number;
};

export type ReliefSideMesh = {
  readonly positions: Float64Array;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly depthMm: number;
};

export type ReliefTwoSidedSplit =
  | {
      readonly kind: 'ok';
      readonly sideA: ReliefSideMesh;
      readonly sideB: ReliefSideMesh;
      /** How far the model's corner moved into each side's frame, in mm. */
      readonly insetMm: number;
      /** The stock thickness the split used: the model's height when the stock is thinner. */
      readonly stockThicknessMm: number;
      readonly fitsStock: boolean;
    }
  | { readonly kind: 'error'; readonly reason: string };

type ModelFrame = {
  readonly positions: Float64Array;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly depthMm: number;
};

export function splitReliefForTwoSides(
  meshPositions: ArrayLike<number>,
  targetWidthMm: number,
  reliefDepthMm: number,
  options: ReliefTwoSidedOptions,
): ReliefTwoSidedSplit {
  const model = modelInMillimetres(meshPositions, targetWidthMm, reliefDepthMm);
  if (typeof model === 'string') return { kind: 'error', reason: model };
  const invalid = invalidOptions(model.depthMm, options);
  if (invalid !== null) return { kind: 'error', reason: invalid };
  const stock = options.stockThicknessMm;
  const fitsStock = stock === undefined || stock >= model.depthMm;
  const thickness = stock === undefined || !fitsStock ? model.depthMm : stock;
  const above = (thickness - model.depthMm) / 2;
  const below = thickness - model.depthMm - above;
  const inset = options.marginMm + TWO_SIDED_FRAME_MM;
  const box = { widthMm: model.widthMm + 2 * inset, heightMm: model.heightMm + 2 * inset };
  const split = options.splitHeightMm;
  const floorB = options.webMm - split;
  return {
    kind: 'ok',
    sideA: sideMesh(model.positions, box, inset, split, model.depthMm + above, 1),
    sideB: sideMesh(model.positions, box, inset, floorB, below, -1),
    insetMm: inset,
    stockThicknessMm: thickness,
    fitsStock,
  };
}

function invalidOptions(depthMm: number, options: ReliefTwoSidedOptions): string | null {
  const { splitHeightMm: split, webMm: web, marginMm: margin } = options;
  if (!(split > 0 && split < depthMm)) {
    return `The split height must lie inside the model, between 0 and ${depthMm} mm.`;
  }
  if (!(web >= 0 && web < split)) return 'The holding web must be at least 0 and below the split.';
  if (!(margin >= 0) || !Number.isFinite(margin)) return 'The margin must be 0 or more.';
  const stock = options.stockThicknessMm;
  if (stock !== undefined && !(stock > 0 && Number.isFinite(stock))) {
    return 'The stock thickness must be a positive number.';
  }
  return null;
}

// The relief's mesh in its placed millimetres: XY at the relief's width, the
// lowest point at z = 0 and the highest at its depth, as relief CAM maps it.
function modelInMillimetres(
  meshPositions: ArrayLike<number>,
  targetWidthMm: number,
  reliefDepthMm: number,
): ModelFrame | string {
  const bounds = meshBounds({ positions: Float64Array.from(meshPositions) });
  if (bounds === null) return 'The relief mesh has no triangles.';
  const xExtent = bounds.maxX - bounds.minX;
  const zExtent = bounds.maxZ - bounds.minZ;
  if (!(xExtent > 0) || !(bounds.maxY > bounds.minY)) return 'The relief mesh is flat in X or Y.';
  if (!(zExtent > 0)) return 'The relief mesh has no height to split.';
  const xy = targetWidthMm / xExtent;
  const z = reliefDepthMm / zExtent;
  const count = Math.floor(meshPositions.length / FLOATS_PER_TRIANGLE) * FLOATS_PER_TRIANGLE;
  const positions = new Float64Array(count);
  for (let at = 0; at < count; at += 3) {
    positions[at] = ((meshPositions[at] ?? 0) - bounds.minX) * xy;
    positions[at + 1] = ((meshPositions[at + 1] ?? 0) - bounds.minY) * xy;
    positions[at + 2] = ((meshPositions[at + 2] ?? 0) - bounds.minZ) * z;
  }
  return {
    positions,
    widthMm: targetWidthMm,
    heightMm: (bounds.maxY - bounds.minY) * xy,
    depthMm: reliefDepthMm,
  };
}

// One side: the model (z flipped for side B) above `floor`, the floor plate,
// and the frame at `faceZ`, the side's stock face, all inset into the box.
function sideMesh(
  model: Float64Array,
  box: { readonly widthMm: number; readonly heightMm: number },
  inset: number,
  floor: number,
  faceZ: number,
  zSign: 1 | -1,
): ReliefSideMesh {
  const out: number[] = [];
  const corner = new Float64Array(9);
  for (let at = 0; at + FLOATS_PER_TRIANGLE <= model.length; at += FLOATS_PER_TRIANGLE) {
    for (let k = 0; k < 3; k += 1) {
      corner[k * 3] = (model[at + k * 3] ?? 0) + inset;
      corner[k * 3 + 1] = (model[at + k * 3 + 1] ?? 0) + inset;
      corner[k * 3 + 2] = zSign * (model[at + k * 3 + 2] ?? 0);
    }
    appendClippedAbove(out, corner, floor);
  }
  appendRectangle(out, 0, 0, box.widthMm, box.heightMm, floor);
  appendFrame(out, box.widthMm, box.heightMm, faceZ);
  return {
    positions: Float64Array.from(out),
    widthMm: box.widthMm,
    heightMm: box.heightMm,
    depthMm: faceZ - floor,
  };
}

// The part of triangle `t` at or above z = floor (0, 1 or 2 triangles).
function appendClippedAbove(out: number[], t: Float64Array, floor: number): void {
  const above: number[] = [];
  for (let k = 0; k < 3; k += 1) {
    const [px, py, pz] = corner(t, k);
    const [qx, qy, qz] = corner(t, (k + 1) % 3);
    if (pz >= floor) above.push(px, py, pz);
    if (pz >= floor !== qz >= floor) {
      const s = (floor - pz) / (qz - pz);
      above.push(px + s * (qx - px), py + s * (qy - py), floor);
    }
  }
  appendFan(out, above);
}

function corner(t: Float64Array, k: number): [number, number, number] {
  return [t[k * 3] ?? 0, t[k * 3 + 1] ?? 0, t[k * 3 + 2] ?? 0];
}

function appendRectangle(
  out: number[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  z: number,
): void {
  out.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z);
}

function appendFrame(out: number[], width: number, height: number, z: number): void {
  const f = TWO_SIDED_FRAME_MM;
  appendRectangle(out, 0, 0, width, f, z);
  appendRectangle(out, 0, height - f, width, height, z);
  appendRectangle(out, 0, f, f, height - f, z);
  appendRectangle(out, width - f, f, width, height - f, z);
}

export type ReliefSideRefit =
  | {
      readonly kind: 'ok';
      readonly positions: Float64Array;
      /** The side's new depth, face to floor, in the mesh's units. */
      readonly depthMm: number;
    }
  /** The face is at or below the floor: this side has no stock to carve. */
  | { readonly kind: 'no-stock' }
  /** The mesh does not end in a split's floor plate and frame, or its floor would drop. */
  | { readonly kind: 'unrecognised' };

type SideLayout = {
  readonly modelFloats: number;
  readonly floorZ: number;
  readonly faceZ: number;
};

/** Where a side's stock face and floor sit, in its mesh's frame. */
export type ReliefSideLevels = { readonly faceZ: number; readonly floorZ: number };

/**
 * A side mesh re-planned with its stock-face frame at `levels.faceZ` and its
 * floor at `levels.floorZ`: the model cut down to the face where it rises
 * above it, and clipped at a floor that may rise but never drop, because the
 * split kept no model below the side's own floor.
 */
export function refitReliefSideMesh(
  positions: ArrayLike<number>,
  levels: ReliefSideLevels,
): ReliefSideRefit {
  const layout = sideMeshLayout(positions);
  if (layout === null) return { kind: 'unrecognised' };
  // The split's own levels, met again, are kept bit for bit.
  const floorZ = sameLevel(levels.floorZ, layout.floorZ);
  const faceZ = sameLevel(levels.faceZ, layout.faceZ);
  if (!(faceZ > floorZ)) return { kind: 'no-stock' };
  if (floorZ < layout.floorZ) return { kind: 'unrecognised' };
  const out: number[] = [];
  const kept: number[] = [];
  for (let at = 0; at < layout.modelFloats; at += FLOATS_PER_TRIANGLE) {
    kept.length = 0;
    appendClippedAbove(kept, triangleAt(positions, at), floorZ);
    for (let piece = 0; piece < kept.length; piece += FLOATS_PER_TRIANGLE) {
      appendCappedAt(out, triangleAt(kept, piece), faceZ);
    }
  }
  const frameAt = layout.modelFloats + FLOOR_FLOATS;
  appendAtLevel(out, positions, layout.modelFloats, FLOOR_FLOATS, floorZ);
  appendAtLevel(out, positions, frameAt, FRAME_FLOATS, faceZ);
  return { kind: 'ok', positions: Float64Array.from(out), depthMm: faceZ - floorZ };
}

// Within Float32 rounding of the stored level, the stored level itself.
function sameLevel(level: number, stored: number): number {
  return Math.abs(level - stored) <= 1e-6 * Math.max(1, Math.abs(stored)) ? stored : level;
}

function triangleAt(positions: ArrayLike<number>, at: number): Float64Array {
  const t = new Float64Array(FLOATS_PER_TRIANGLE);
  for (let k = 0; k < FLOATS_PER_TRIANGLE; k += 1) t[k] = positions[at + k] ?? 0;
  return t;
}

// The `floats` of `positions` from `start`, laid level at `z`.
function appendAtLevel(
  out: number[],
  positions: ArrayLike<number>,
  start: number,
  floats: number,
  z: number,
): void {
  for (let at = start; at < start + floats; at += 3) {
    out.push(positions[at] ?? 0, positions[at + 1] ?? 0, z);
  }
}

// The split's tail: a level floor plate and a level frame over the same box,
// the frame the mesh's highest point.
function sideMeshLayout(positions: ArrayLike<number>): SideLayout | null {
  const count = positions.length;
  if (count % FLOATS_PER_TRIANGLE !== 0 || count < FLOOR_FLOATS + FRAME_FLOATS) return null;
  const modelFloats = count - FLOOR_FLOATS - FRAME_FLOATS;
  const floor = levelBox(positions, modelFloats, FLOOR_FLOATS);
  const frame = levelBox(positions, modelFloats + FLOOR_FLOATS, FRAME_FLOATS);
  if (floor === null || frame === null || !(frame.z > floor.z)) return null;
  const sameBox = (['minX', 'minY', 'maxX', 'maxY'] as const).every(
    (key) => floor[key] === frame[key],
  );
  if (!sameBox) return null;
  let top = Number.NEGATIVE_INFINITY;
  for (let at = 2; at < modelFloats; at += 3) top = Math.max(top, positions[at] ?? 0);
  // The model meets the face when the split's stock was the model's height.
  if (top > frame.z + 1e-9 * Math.max(1, Math.abs(frame.z))) return null;
  return { modelFloats, floorZ: floor.z, faceZ: frame.z };
}

function levelBox(
  positions: ArrayLike<number>,
  start: number,
  floats: number,
): { z: number; minX: number; minY: number; maxX: number; maxY: number } | null {
  const z = positions[start + 2] ?? Number.NaN;
  const box = { z, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let at = start; at < start + floats; at += 3) {
    const x = positions[at] ?? Number.NaN;
    const y = positions[at + 1] ?? Number.NaN;
    if (positions[at + 2] !== z || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    box.minX = Math.min(box.minX, x);
    box.minY = Math.min(box.minY, y);
    box.maxX = Math.max(box.maxX, x);
    box.maxY = Math.max(box.maxY, y);
  }
  return Number.isFinite(z) ? box : null;
}

// Triangle `t` as the surface min(t, cap): the part below the cap as it is, the
// part above it laid flat on the cap, so the stock face caps the model there.
function appendCappedAt(out: number[], t: Float64Array, cap: number): void {
  const below: number[] = [];
  const above: number[] = [];
  for (let k = 0; k < 3; k += 1) {
    const [px, py, pz] = corner(t, k);
    const [qx, qy, qz] = corner(t, (k + 1) % 3);
    (pz <= cap ? below : above).push(px, py, Math.min(pz, cap));
    if (pz <= cap !== qz <= cap) {
      const s = (cap - pz) / (qz - pz);
      const x = px + s * (qx - px);
      const y = py + s * (qy - py);
      below.push(x, y, cap);
      above.push(x, y, cap);
    }
  }
  appendFan(out, below);
  appendFan(out, above);
}

// A convex polygon of 3 or 4 corners, fanned from its first.
function appendFan(out: number[], polygon: ReadonlyArray<number>): void {
  for (let k = 1; k + 1 < polygon.length / 3; k += 1) {
    out.push(
      ...polygon.slice(0, 3),
      ...polygon.slice(k * 3, k * 3 + 3),
      ...polygon.slice(k * 3 + 3, k * 3 + 6),
    );
  }
}
