// Which side of a cut boundary holds material (ADR-408). Closed paths fill
// even-odd, as the traced and imported artwork is drawn: a point is material
// when an odd number of closed paths enclose it. The side of one piece is
// decided locally — the region just inside a closed path is material when an
// even number of OTHER closed paths enclose that path — so a whole feature
// costs one cached ray per path instead of one ray per witness.

import type { MinFeatureWorkMeter } from './feature-budget';
import { cellColumn, cellKey, cellRow, num, type PieceIndex } from './piece-index';

const UNKNOWN = -1;
/** Below this sine the witness chord runs along the piece, so the piece
 * cannot say which side the chord's midpoint is on. */
const MIN_SIDE_SINE = 0.5;

export class FeatureSides {
  private readonly enclosure: Int8Array;
  private readonly rayMark: Int32Array;
  private rayGeneration = 0;

  constructor(
    private readonly index: PieceIndex,
    private readonly meter: MinFeatureWorkMeter,
  ) {
    this.enclosure = new Int8Array(index.pathClosed.length).fill(UNKNOWN);
    this.rayMark = new Int32Array(index.count).fill(-1);
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

  /** Crossing parity of the ray from (x0, y0) towards +X against closed
   * paths other than `excludedPath`; null when the budget ran out. */
  private rayParity(x0: number, y0: number, excludedPath: number): 0 | 1 | null {
    const index = this.index;
    this.rayGeneration += 1;
    const generation = this.rayGeneration;
    const row = cellRow(index, y0);
    let parity: 0 | 1 = 0;
    for (let column = cellColumn(index, x0); column < index.cols; column += 1) {
      const key = cellKey(index, column, row);
      const end = num(index.cellStart, key + 1);
      for (let slot = num(index.cellStart, key); slot < end; slot += 1) {
        const piece = num(index.cellItems, slot);
        if (this.rayMark[piece] === generation) continue;
        this.rayMark[piece] = generation;
        const path = num(index.path, piece);
        if (path === excludedPath || index.pathClosed[path] !== true) continue;
        if (!this.meter.takePairTests(1)) return null;
        if (crossesRay(index, piece, x0, y0)) parity = parity === 0 ? 1 : 0;
      }
    }
    return parity;
  }
}

function crossesRay(index: PieceIndex, piece: number, x0: number, y0: number): boolean {
  const ay = num(index.ay, piece);
  const by = num(index.by, piece);
  if (ay > y0 === by > y0) return false;
  const ax = num(index.ax, piece);
  const bx = num(index.bx, piece);
  const x = ax + ((y0 - ay) / (by - ay)) * (bx - ax);
  return x > x0;
}
