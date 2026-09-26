// Which closed paths can enclose a point, for the minimum-feature check's
// inside/outside rays (ADR-433). A closed path whose bounding box does not
// contain a point crosses any ray from it an even number of times, so only
// the paths whose box contains the point decide its parity. Boxes are kept in
// a coarse grid; a box spanning many coarse cells (a stencil sheet, a traced
// outer contour) goes in a short list every query checks instead.

import { num, type PieceIndex } from './piece-index';

/** Coarse cells per side: about one closed path per cell, at most this. */
const MAX_COARSE_SIDE = 256;
/** A box over more coarse cells than this is checked on every query. */
const MAX_CELLS_PER_BOX = 16;

export class PathBoxIndex {
  private readonly side: number;
  private readonly cellWidth: number;
  private readonly cellHeight: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly cellStart: Int32Array;
  private readonly cellItems: Int32Array;
  private readonly large: ReadonlyArray<number>;

  constructor(private readonly index: PieceIndex) {
    const closed: number[] = [];
    index.pathClosed.forEach((isClosed, path) => {
      if (isClosed) closed.push(path);
    });
    this.side = Math.max(1, Math.min(MAX_COARSE_SIDE, Math.ceil(Math.sqrt(closed.length))));
    this.minX = index.minX;
    this.minY = index.minY;
    const spanX = index.cols * index.cellSize;
    const spanY = index.rows * index.cellSize;
    this.cellWidth = spanX / this.side;
    this.cellHeight = spanY / this.side;
    const large: number[] = [];
    const small: number[] = [];
    for (const path of closed) {
      const [c0, c1, r0, r1] = this.boxCells(path);
      if ((c1 - c0 + 1) * (r1 - r0 + 1) > MAX_CELLS_PER_BOX) large.push(path);
      else small.push(path);
    }
    this.large = large;
    const counts = new Int32Array(this.side * this.side + 1);
    for (const path of small)
      this.forBoxCells(path, (key) => (counts[key + 1] = num(counts, key + 1) + 1));
    for (let key = 1; key < counts.length; key += 1)
      counts[key] = num(counts, key) + num(counts, key - 1);
    const items = new Int32Array(num(counts, counts.length - 1));
    const cursor = counts.slice(0, counts.length - 1);
    for (const path of small) {
      this.forBoxCells(path, (key) => {
        const slot = num(cursor, key);
        items[slot] = path;
        cursor[key] = slot + 1;
      });
    }
    this.cellStart = counts;
    this.cellItems = items;
  }

  /** Every closed path other than `excluded` whose box contains (x, y),
   * appended to `out`; returns the number of boxes checked (the work). */
  candidates(x: number, y: number, excluded: number, out: number[]): number {
    const index = this.index;
    let checked = 0;
    const consider = (path: number): void => {
      checked += 1;
      if (path === excluded) return;
      if (x < num(index.pathMinX, path) || x > num(index.pathMaxX, path)) return;
      if (y < num(index.pathMinY, path) || y > num(index.pathMaxY, path)) return;
      out.push(path);
    };
    for (const path of this.large) consider(path);
    const key = this.row(y) * this.side + this.column(x);
    const end = num(this.cellStart, key + 1);
    for (let slot = num(this.cellStart, key); slot < end; slot += 1) {
      consider(num(this.cellItems, slot));
    }
    return checked;
  }

  private column(x: number): number {
    if (!(this.cellWidth > 0)) return 0;
    return Math.min(this.side - 1, Math.max(0, Math.floor((x - this.minX) / this.cellWidth)));
  }

  private row(y: number): number {
    if (!(this.cellHeight > 0)) return 0;
    return Math.min(this.side - 1, Math.max(0, Math.floor((y - this.minY) / this.cellHeight)));
  }

  private boxCells(path: number): [number, number, number, number] {
    const index = this.index;
    return [
      this.column(num(index.pathMinX, path)),
      this.column(num(index.pathMaxX, path)),
      this.row(num(index.pathMinY, path)),
      this.row(num(index.pathMaxY, path)),
    ];
  }

  private forBoxCells(path: number, visit: (key: number) => void): void {
    const [c0, c1, r0, r1] = this.boxCells(path);
    for (let row = r0; row <= r1; row += 1) {
      for (let column = c0; column <= c1; column += 1) visit(row * this.side + column);
    }
  }
}
