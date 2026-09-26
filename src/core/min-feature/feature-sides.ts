// Which side of a cut boundary holds material (ADR-433). Closed paths fill
// even-odd, as the traced and imported artwork is drawn: a point is material
// when an odd number of closed paths enclose it. The side of one piece is
// decided locally — the region just inside a closed path is material when an
// even number of OTHER closed paths enclose that path — so a whole feature
// costs one cached ray per path instead of one ray per witness.
//
// A ray counts crossings only against the closed paths whose bounding box
// holds its start (no other path can change the parity), and takes the
// cheapest exact route: those paths' own segments, or the grid row towards
// whichever side of their boxes is nearer. Every box, cell and edge it
// touches is counted, so a sheet of thousands of small parts stays inside the
// work budget instead of walking a whole grid row per part.

import type { MinFeatureWorkMeter } from './feature-budget';
import { PathBoxIndex } from './path-box-index';
import { cellColumn, cellKey, cellRow, num, type PieceIndex } from './piece-index';

const UNKNOWN = -1;
/** Below this sine the witness chord runs along the piece, so the piece
 * cannot say which side the chord's midpoint is on. */
const MIN_SIDE_SINE = 0.5;

export class FeatureSides {
  private readonly enclosure: Int8Array;
  private readonly rayMark: Int32Array;
  private readonly candidateMark: Int32Array;
  private readonly candidates: number[] = [];
  private boxes: PathBoxIndex | null = null;
  private rayGeneration = 0;

  constructor(
    private readonly index: PieceIndex,
    private readonly meter: MinFeatureWorkMeter,
  ) {
    this.enclosure = new Int8Array(index.pathClosed.length).fill(UNKNOWN);
    this.rayMark = new Int32Array(index.count).fill(-1);
    this.candidateMark = new Int32Array(index.pathClosed.length).fill(-1);
  }

  /** True when M (the midpoint of a witness chord from P on piece p to Q on
   * piece q) lies in material; null when the work budget ran out. Callers
   * guarantee both pieces belong to closed paths and that no boundary lies
   * between the chord's midpoint and either end. */
  materialAt(
    p: number,
    q: number,
    point: { readonly px: number; readonly py: number; readonly mx: number; readonly my: number },
    half: number,
  ): boolean | null {
    const qx = 2 * point.mx - point.px;
    const qy = 2 * point.my - point.py;
    const fromP = this.sideSine(p, point.px, point.py, point.mx, point.my, half);
    const fromQ = this.sideSine(q, qx, qy, point.mx, point.my, half);
    const best =
      Math.abs(fromP.sine) >= Math.abs(fromQ.sine)
        ? { piece: p, ...fromP }
        : { piece: q, ...fromQ };
    if (Math.abs(best.sine) < MIN_SIDE_SINE) {
      const parity = this.rayParity(point.mx, point.my, -1);
      return parity === null ? null : parity === 1;
    }
    const path = num(this.index.path, best.piece);
    const enclosed = this.enclosureParity(path);
    if (enclosed === null) return null;
    const interiorOnLeft = num(this.index.pathArea, path) > 0;
    const onInterior = best.sine > 0 === interiorOnLeft;
    return onInterior ? enclosed === 0 : enclosed === 1;
  }

  private sideSine(
    piece: number,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    half: number,
  ): { readonly sine: number } {
    const ux = num(this.index.bx, piece) - num(this.index.ax, piece);
    const uy = num(this.index.by, piece) - num(this.index.ay, piece);
    const length = Math.hypot(ux, uy);
    if (length === 0 || half === 0) return { sine: 0 };
    const cross = ux * (toY - fromY) - uy * (toX - fromX);
    return { sine: cross / (length * half) };
  }

  private enclosureParity(path: number): 0 | 1 | null {
    const cached = this.enclosure[path] ?? UNKNOWN;
    if (cached !== UNKNOWN) return cached === 1 ? 1 : 0;
    const first = num(this.index.pathStart, path);
    const parity = this.rayParity(num(this.index.ax, first), num(this.index.ay, first), path);
    if (parity === null) return null;
    this.enclosure[path] = parity;
    return parity;
  }

  /** Even-odd parity of (x0, y0) against the closed paths other than
   * `excludedPath`; null when the budget ran out. */
  private rayParity(x0: number, y0: number, excludedPath: number): 0 | 1 | null {
    const index = this.index;
    this.boxes ??= new PathBoxIndex(index);
    const candidates = this.candidates;
    candidates.length = 0;
    const checked = this.boxes.candidates(x0, y0, excludedPath, candidates);
    if (!this.meter.takePairTests(checked)) return null;
    if (candidates.length === 0) return 0;
    this.rayGeneration += 1;
    const generation = this.rayGeneration;
    let segmentCost = 0;
    let reachMinX = Infinity;
    let reachMaxX = -Infinity;
    for (const path of candidates) {
      this.candidateMark[path] = generation;
      segmentCost += num(index.segStart, path + 1) - num(index.segStart, path);
      reachMinX = Math.min(reachMinX, num(index.pathMinX, path));
      reachMaxX = Math.max(reachMaxX, num(index.pathMaxX, path));
    }
    const row = cellRow(index, y0);
    const here = cellColumn(index, x0);
    const rightCost = this.rowCost(row, here, cellColumn(index, reachMaxX));
    const leftCost = this.rowCost(row, cellColumn(index, reachMinX), here);
    const cost = Math.min(segmentCost, rightCost, leftCost);
    if (!this.meter.takePairTests(cost)) return null;
    if (cost === segmentCost) return this.segmentParity(x0, y0);
    return cost === rightCost
      ? this.rowParity(x0, y0, row, here, cellColumn(index, reachMaxX), 1, generation)
      : this.rowParity(x0, y0, row, cellColumn(index, reachMinX), here, -1, generation);
  }

  /** Cells plus pieces in grid row `row`, columns c0..c1. */
  private rowCost(row: number, c0: number, c1: number): number {
    const first = cellKey(this.index, c0, row);
    const last = cellKey(this.index, c1, row);
    const entries = num(this.index.cellStart, last + 1) - num(this.index.cellStart, first);
    return c1 - c0 + 1 + entries;
  }

  private segmentParity(x0: number, y0: number): 0 | 1 {
    const index = this.index;
    let parity: 0 | 1 = 0;
    for (const path of this.candidates) {
      const end = num(index.segStart, path + 1);
      for (let segment = num(index.segStart, path); segment < end; segment += 1) {
        const crosses = crossesRay(
          num(index.segAx, segment),
          num(index.segAy, segment),
          num(index.segBx, segment),
          num(index.segBy, segment),
          x0,
          y0,
          1,
        );
        if (crosses) parity = parity === 0 ? 1 : 0;
      }
    }
    return parity;
  }

  /** Parity of the ray from (x0, y0) along grid row `row` (towards +X when
   * `direction` is 1, else -X), against candidate paths' pieces only. */
  private rowParity(
    x0: number,
    y0: number,
    row: number,
    c0: number,
    c1: number,
    direction: 1 | -1,
    generation: number,
  ): 0 | 1 {
    const index = this.index;
    let parity: 0 | 1 = 0;
    for (let column = c0; column <= c1; column += 1) {
      const key = cellKey(index, column, row);
      const end = num(index.cellStart, key + 1);
      for (let slot = num(index.cellStart, key); slot < end; slot += 1) {
        const piece = num(index.cellItems, slot);
        if (this.rayMark[piece] === generation) continue;
        this.rayMark[piece] = generation;
        if (this.candidateMark[num(index.path, piece)] !== generation) continue;
        const crosses = crossesRay(
          num(index.ax, piece),
          num(index.ay, piece),
          num(index.bx, piece),
          num(index.by, piece),
          x0,
          y0,
          direction,
        );
        if (crosses) parity = parity === 0 ? 1 : 0;
      }
    }
    return parity;
  }
}

/** Whether segment A-B crosses the horizontal ray from (x0, y0) towards +X
 * (direction 1) or -X (direction -1). Half-open in Y, so a vertex on the ray
 * counts once; both directions give the same parity for closed paths. */
function crossesRay(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  x0: number,
  y0: number,
  direction: 1 | -1,
): boolean {
  if (ay > y0 === by > y0) return false;
  const x = ax + ((y0 - ay) / (by - ay)) * (bx - ax);
  return direction === 1 ? x > x0 : x < x0;
}
