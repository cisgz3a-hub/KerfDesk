// Independent fit check for a tapered V-bit inlay pair (CNC audit v1 F5, ADR-665). It reads only
// the emitted G-code of both pieces: its own parser, an exact pointed-cone sweep of every linear
// move into a height field, its own mirror of the plug into the pocket's frame and its own
// distance transform. No planner, V-carve or simulator code is used.

import type { Polyline } from '../scene';

type LinearMove = readonly [number, number, number, number, number, number];

/** Absolute linear moves that cut: every G1, and any G0 that dips below Z0. */
function emittedLinearMoves(program: string): ReadonlyArray<LinearMove> {
  const moves: LinearMove[] = [];
  let position = { x: 0, y: 0, z: 0 };
  let motion = 0;
  for (const raw of program.split(/\r?\n/)) {
    const code = raw
      .replace(/;.*/, '')
      .replace(/\(.*?\)/g, '')
      .toUpperCase();
    const next = { ...position };
    let moved = false;
    for (const [, letter, text] of code.matchAll(/([A-Z])\s*([+-]?(?:\d+\.?\d*|\.\d+))/g)) {
      const value = Number(text);
      if (letter === 'G') motion = motionMode(value, motion);
      if (letter === 'X' || letter === 'Y' || letter === 'Z') {
        next[letter.toLowerCase() as 'x' | 'y' | 'z'] = value;
        moved = true;
      }
    }
    if (!moved) continue;
    if (motion === 1 || Math.min(position.z, next.z) < 0)
      moves.push([position.x, position.y, position.z, next.x, next.y, next.z]);
    position = next;
  }
  return moves;
}

function motionMode(code: number, current: number): number {
  if (code === 2 || code === 3 || code === 91) throw new Error(`G${code} is not modelled.`);
  return code === 0 || code === 1 ? code : current;
}

/** Cut depth below Z0 (>= 0) per cell at x = x0 + i * hx, y = y0 + j * h; hx < 0 mirrors. */
type DepthField = {
  readonly x0: number;
  readonly hx: number;
  readonly nx: number;
  readonly y0: number;
  readonly h: number;
  readonly ny: number;
  readonly depth: Float64Array;
};

function depthField(x0: number, hx: number, nx: number, y0: number, h: number, ny: number) {
  return { x0, hx, nx, y0, h, ny, depth: new Float64Array(nx * ny) };
}

/** Lowest point of the pointed cone (slope = tan of half the angle) over q along one move. */
function coneSurfaceZ(move: LinearMove, qx: number, qy: number, slope: number): number {
  const [ax, ay, az, bx, by, bz] = move;
  const dx = bx - ax,
    dy = by - ay,
    dz = bz - az;
  const wx = qx - ax,
    wy = qy - ay;
  const at = (t: number) => az + t * dz + Math.hypot(wx - t * dx, wy - t * dy) / slope;
  let lowest = Math.min(at(0), at(1));
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return lowest;
  const along = (wx * dx + wy * dy) / length;
  const across = Math.abs(wx * dy - wy * dx) / length;
  const k = (-dz * slope) / length;
  if (Math.abs(k) >= 1) return lowest;
  const t = (along + (k * across) / Math.sqrt(1 - k * k)) / length;
  if (t > 0 && t < 1) lowest = Math.min(lowest, at(t));
  return lowest;
}

function cellRange(origin: number, step: number, count: number, lo: number, hi: number) {
  let first = Math.floor((lo - origin) / step);
  let last = Math.ceil((hi - origin) / step);
  if (first > last) [first, last] = [last, first];
  return { first: Math.max(0, first), last: Math.min(count - 1, last) };
}

/**
 * Sweep a pointed V-bit of the given slope and radius along every move into the field. Returns
 * the most any single move deepened the field below what the moves before it had cut.
 */
function sweepPointedCone(
  field: DepthField,
  moves: ReadonlyArray<LinearMove>,
  slope: number,
  radiusMm: number,
): number {
  let deepestCut = 0;
  for (const move of moves) {
    const deepest = -Math.min(move[2], move[5]);
    if (!(deepest > 0)) continue;
    const reach = Math.min(radiusMm, deepest * slope);
    const xs = cellRange(
      field.x0,
      field.hx,
      field.nx,
      Math.min(move[0], move[3]) - reach,
      Math.max(move[0], move[3]) + reach,
    );
    const ys = cellRange(
      field.y0,
      field.h,
      field.ny,
      Math.min(move[1], move[4]) - reach,
      Math.max(move[1], move[4]) + reach,
    );
    for (let j = ys.first; j <= ys.last; j += 1) {
      for (let i = xs.first; i <= xs.last; i += 1) {
        const cut = -coneSurfaceZ(move, field.x0 + i * field.hx, field.y0 + j * field.h, slope);
        const k = j * field.nx + i;
        const before = field.depth[k] ?? 0;
        if (cut <= before) continue;
        deepestCut = Math.max(deepestCut, cut - before);
        field.depth[k] = cut;
      }
    }
  }
  return deepestCut;
}

/** Distance from (x, y) to the nearest edge of the polygons, negative outside (even-odd). */
function signedDistance(polygons: ReadonlyArray<Polyline>, x: number, y: number): number {
  let inside = false;
  let nearest = Infinity;
  for (const { points } of polygons) {
    for (let index = 0, prev = points.length - 1; index < points.length; prev = index++) {
      const a = points[index],
        b = points[prev];
      if (a === undefined || b === undefined) continue;
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x)
        inside = !inside;
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
      nearest = Math.min(nearest, Math.hypot(x - a.x - t * dx, y - a.y - t * dy));
    }
  }
  return inside ? nearest : -nearest;
}

/** The exact V-carved pocket of the source: its depth is the edge distance over the slope. */
function analyticPocketField(
  frame: DepthField,
  polygons: ReadonlyArray<Polyline>,
  slope: number,
  maxDepthMm: number,
): DepthField {
  const field = depthField(frame.x0, frame.hx, frame.nx, frame.y0, frame.h, frame.ny);
  for (let j = 0; j < field.ny; j += 1) {
    for (let i = 0; i < field.nx; i += 1) {
      const distance = signedDistance(polygons, field.x0 + i * field.hx, field.y0 + j * field.h);
      field.depth[j * field.nx + i] = Math.max(0, Math.min(maxDepthMm, distance / slope));
    }
  }
  return field;
}

/** Exact Euclidean distance (mm) from every cell to the nearest set cell (Felzenszwalb). */
function distanceToSet(mask: Uint8Array, nx: number, ny: number, h: number): Float64Array {
  const rows = new Float64Array(nx * ny);
  const line = new Float64Array(Math.max(nx, ny));
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) line[i] = mask[j * nx + i] === 1 ? 0 : 1e20;
    const out = squaredDistance1d(line, nx);
    for (let i = 0; i < nx; i += 1) rows[j * nx + i] = out[i] ?? 0;
  }
  const result = new Float64Array(nx * ny);
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < ny; j += 1) line[j] = rows[j * nx + i] ?? 0;
    const out = squaredDistance1d(line, ny);
    for (let j = 0; j < ny; j += 1) result[j * nx + i] = Math.sqrt(out[j] ?? 0) * h;
  }
  return result;
}

function read(array: Float64Array | Int32Array, index: number, missing = 0): number {
  return array[index] ?? missing;
}

/** Lower envelope of the parabolas (q - p)^2 + f(p), sampled at every q. */
function squaredDistance1d(f: Float64Array, n: number): Float64Array {
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const value = (q: number) => read(f, q) + q * q;
  const meet = (q: number, p: number) => (value(q) - value(p)) / (2 * q - 2 * p);
  let k = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q += 1) {
    let s = meet(q, read(v, k));
    while (s <= read(z, k)) {
      k -= 1;
      s = meet(q, read(v, k));
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  const out = new Float64Array(n);
  k = 0;
  for (let q = 0; q < n; q += 1) {
    while (read(z, k + 1, Infinity) < q) k += 1;
    const p = read(v, k);
    out[q] = (q - p) * (q - p) + read(f, p);
  }
  return out;
}

/** The seam is read this far below the pocket top, where a flush planing leaves it. */
const SURFACE_PLANE_MM = 0.02;

export type InlayPairFitInput = {
  readonly pocketProgram: string;
  readonly plugProgram: string;
  /** The inlay source in program coordinates, filled even-odd. */
  readonly source: ReadonlyArray<Polyline>;
  /** A plug point at x lands at mirrorSumX - x in the pocket. */
  readonly mirrorSumX: number;
  readonly includedAngleDeg: number;
  readonly toolRadiusMm: number;
  readonly pocketDepthMm: number;
  /** Where the design says the plug's top surface comes to rest below the pocket top. */
  readonly designedSeatMm: number;
  readonly gridMm: number;
  readonly marginMm: number;
};

export type SeatedInlay = {
  /** Depth of the plug's top surface below the pocket top where it stops. */
  readonly seatMm: number;
  /** Deepest overlap if the plug were pushed to its designed seat (negative: it sits deeper). */
  readonly interferenceAtDesignedSeatMm: number;
  /** Where the plug first touches the pocket, and how deep the pocket is cut there. */
  readonly contactAt: { readonly x: number; readonly y: number; readonly pocketDepthMm: number };
  /** Widest void between plug and pocket at the surface plane. */
  readonly worstGapMm: number;
  readonly worstGapAt: { readonly x: number; readonly y: number };
  readonly voidAreaMm2: number;
  /** Plug material where the pocket was not cut at the surface plane. */
  readonly interferenceAreaMm2: number;
};

export type InlayPairFit = {
  /** The emitted plug in the emitted pocket. */
  readonly emitted: SeatedInlay;
  /** The emitted plug in the exact V-carved pocket of the source. */
  readonly exactPocket: SeatedInlay;
  /** How much shallower than exact the emitted pocket is where the emitted plug first touches. */
  readonly pocketShortfallAtContactMm: number;
  /** Where the plug's cut extent is centred once mirrored into the pocket frame. */
  readonly mirroredPlugCentreX: number;
};

/** Seat the emitted plug in the emitted pocket, and in the exact pocket, and measure the fit. */
export function measureInlayPairFit(input: InlayPairFitInput): InlayPairFit {
  const slope = Math.tan((input.includedAngleDeg * Math.PI) / 360);
  const h = input.gridMm;
  const bounds = sourceBounds(input.source);
  const x0 = bounds.minX - input.marginMm;
  const y0 = bounds.minY - input.marginMm;
  const nx = Math.ceil((bounds.maxX - bounds.minX + 2 * input.marginMm) / h) + 1;
  const ny = Math.ceil((bounds.maxY - bounds.minY + 2 * input.marginMm) / h) + 1;
  const pocket = depthField(x0, h, nx, y0, h, ny);
  sweepPointedCone(pocket, emittedLinearMoves(input.pocketProgram), slope, input.toolRadiusMm);
  const plugMoves = emittedLinearMoves(input.plugProgram);
  const plug = depthField(input.mirrorSumX - x0, -h, nx, y0, h, ny);
  sweepPointedCone(plug, plugMoves, slope, input.toolRadiusMm);
  const exact = analyticPocketField(pocket, input.source, slope, input.pocketDepthMm);
  const contact = lowestContact(pocket, plug).cell;
  return {
    emitted: seated(pocket, plug, input.designedSeatMm),
    exactPocket: seated(exact, plug, input.designedSeatMm),
    pocketShortfallAtContactMm: (exact.depth[contact] ?? 0) - (pocket.depth[contact] ?? 0),
    mirroredPlugCentreX: input.mirrorSumX - cutCentreX(plugMoves),
  };
}

function sourceBounds(polygons: ReadonlyArray<Polyline>) {
  const xs = polygons.flatMap(({ points }) => points.map((point) => point.x));
  const ys = polygons.flatMap(({ points }) => points.map((point) => point.y));
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

/** The plug stops at the cell where pocket depth plus plug cut depth is least. */
function lowestContact(pocket: DepthField, plug: DepthField) {
  let contact = { seatMm: Infinity, cell: 0 };
  for (let k = 0; k < pocket.nx * pocket.ny; k += 1) {
    const sum = (pocket.depth[k] ?? 0) + (plug.depth[k] ?? 0);
    if (sum < contact.seatMm) contact = { seatMm: sum, cell: k };
  }
  return contact;
}

function seated(pocket: DepthField, plug: DepthField, designedSeatMm: number): SeatedInlay {
  const { nx, ny, h } = pocket;
  const contact = lowestContact(pocket, plug);
  const plugAtPlane = new Uint8Array(nx * ny);
  for (let k = 0; k < nx * ny; k += 1)
    plugAtPlane[k] = read(plug.depth, k) <= contact.seatMm - SURFACE_PLANE_MM ? 1 : 0;
  const plane = surfacePlane(pocket, plugAtPlane);
  return {
    seatMm: contact.seatMm,
    interferenceAtDesignedSeatMm: designedSeatMm - contact.seatMm,
    contactAt: {
      ...cellCentre(pocket, contact.cell),
      pocketDepthMm: read(pocket.depth, contact.cell),
    },
    worstGapMm: plane.worstGapMm,
    worstGapAt: cellCentre(pocket, plane.worstCell),
    voidAreaMm2: plane.voids * h * h,
    interferenceAreaMm2: plane.interference * h * h,
  };
}

/** Voids and overlaps between the pocket and the seated plug at the surface plane. */
function surfacePlane(pocket: DepthField, plugAtPlane: Uint8Array) {
  const toPlug = distanceToSet(plugAtPlane, pocket.nx, pocket.ny, pocket.h);
  let voids = 0;
  let interference = 0;
  let worstGapMm = 0;
  let worstCell = 0;
  for (let k = 0; k < plugAtPlane.length; k += 1) {
    const cavity = read(pocket.depth, k) > SURFACE_PLANE_MM;
    const plugHere = plugAtPlane[k] === 1;
    if (plugHere && !cavity) interference += 1;
    if (plugHere || !cavity) continue;
    voids += 1;
    if (read(toPlug, k) <= worstGapMm) continue;
    worstGapMm = read(toPlug, k);
    worstCell = k;
  }
  return { voids, interference, worstGapMm, worstCell };
}

function cellCentre(field: DepthField, k: number) {
  return {
    x: field.x0 + (k % field.nx) * field.hx,
    y: field.y0 + Math.floor(k / field.nx) * field.h,
  };
}

function cutCentreX(moves: ReadonlyArray<LinearMove>): number {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const [ax, , az, bx, , bz] of moves) {
    if (Math.min(az, bz) >= 0) continue;
    minX = Math.min(minX, ax, bx);
    maxX = Math.max(maxX, ax, bx);
  }
  return (minX + maxX) / 2;
}

/** The most any one move of the program deepens the stock below what the moves before it cut. */
export function deepestCutPerMove(
  program: string,
  frame: {
    readonly x0: number;
    readonly y0: number;
    readonly h: number;
    readonly nx: number;
    readonly ny: number;
  },
  slope: number,
  radiusMm: number,
): number {
  const stock = depthField(frame.x0, frame.h, frame.nx, frame.y0, frame.h, frame.ny);
  return sweepPointedCone(stock, emittedLinearMoves(program), slope, radiusMm);
}
