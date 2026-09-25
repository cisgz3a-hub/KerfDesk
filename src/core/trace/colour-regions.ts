// Shared-boundary planar map of a colour label image (ADR-402). Own design.
//
// Every boundary between two differently-labelled pixels is a unit "crack" on
// the pixel-corner lattice. Lattice vertices where three or more cracks meet
// (three colours, or a diagonal checkerboard) are junctions. A chain is the
// crack run between two junctions (or a junction-free closed loop), and it
// separates exactly one pair of labels. Each chain is extracted ONCE and later
// finished into curves once; every region outline is then assembled from
// whole chains, forward or reversed. Two neighbouring colours therefore share
// the very same curve: no gap and no overlap by construction, the property
// per-colour tracing (Inkscape's multi-scan, imagetracerjs layers) lacks.
//
// Pure core: deterministic, no clock, no random, no I/O.

/** Region label for pixels that are not traced (outside the image, the
 *  excluded background, transparency). */
export const VOID_REGION = -1;

// Directions on the lattice, clockwise on screen (y down): E, S, W, N.
const DX = [1, 0, -1, 0] as const;
const DY = [0, 1, 0, -1] as const;

export type BoundaryChain = {
  readonly closed: boolean;
  /** Lattice vertices. Open: cracks + 1 vertices, junction to junction.
   *  Closed: one vertex per crack; crack i joins vertex i to vertex i+1 and
   *  the last crack returns to vertex 0. */
  readonly xs: Int32Array;
  readonly ys: Int32Array;
  /** Direction of each crack (0 E, 1 S, 2 W, 3 N). */
  readonly dirs: Uint8Array;
  /** Pixel on each crack's left / right (index, or -1 outside the image). */
  readonly leftPixels: Int32Array;
  readonly rightPixels: Int32Array;
  /** Region label on the left / right of the whole chain. */
  readonly left: number;
  readonly right: number;
};

/** A chain used in one outline, forward (region on its left) or reversed. */
export type LoopPiece = { readonly chain: number; readonly reversed: boolean };

export type RegionLabelGrid = {
  readonly width: number;
  readonly height: number;
  /** Region label per pixel; VOID_REGION for untraced pixels. */
  readonly regions: Int16Array;
};

export function extractBoundaryChains(grid: RegionLabelGrid): BoundaryChain[] {
  const walker = new ChainWalker(grid);
  const { width, height } = grid;
  const chains: BoundaryChain[] = [];
  const walkUnvisited = (x: number, y: number, d: number): void => {
    if (walker.hasEdge(x, y, d) && !walker.visited(x, y, d)) chains.push(walker.walk(x, y, d));
  };
  // Open chains, junction to junction.
  forEachVertex(width, height, (x, y) => {
    if (walker.degree(x, y) < 3) return;
    for (let d = 0; d < 4; d += 1) walkUnvisited(x, y, d);
  });
  // Whatever is left lies on junction-free closed loops, which every
  // horizontal (E) or vertical (S) crack they contain can start.
  forEachVertex(width, height, (x, y) => {
    walkUnvisited(x, y, 0);
    walkUnvisited(x, y, 1);
  });
  return chains;
}

function forEachVertex(width: number, height: number, visit: (x: number, y: number) => void): void {
  for (let y = 0; y <= height; y += 1) {
    for (let x = 0; x <= width; x += 1) visit(x, y);
  }
}

class ChainWalker {
  private readonly width: number;
  private readonly height: number;
  private readonly regions: Int16Array;
  // Horizontal cracks (x, y)-(x+1, y): index y * width + x.
  private readonly hSeen: Uint8Array;
  // Vertical cracks (x, y)-(x, y+1): index y * (width + 1) + x.
  private readonly vSeen: Uint8Array;

  constructor(grid: RegionLabelGrid) {
    this.width = grid.width;
    this.height = grid.height;
    this.regions = grid.regions;
    this.hSeen = new Uint8Array(grid.width * (grid.height + 1));
    this.vSeen = new Uint8Array((grid.width + 1) * grid.height);
  }

  cell(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return VOID_REGION;
    return this.regions[y * this.width + x] as number;
  }

  pixel(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return -1;
    return y * this.width + x;
  }

  /** Left and right cell of the crack leaving vertex (x, y) in direction d. */
  sideCells(x: number, y: number, d: number): readonly [number, number, number, number] {
    if (d === 0) return [x, y - 1, x, y];
    if (d === 1) return [x, y, x - 1, y];
    if (d === 2) return [x - 1, y, x - 1, y - 1];
    return [x - 1, y - 1, x, y - 1];
  }

  hasEdge(x: number, y: number, d: number): boolean {
    if (d === 0 && x >= this.width) return false;
    if (d === 1 && y >= this.height) return false;
    if (d === 2 && x <= 0) return false;
    if (d === 3 && y <= 0) return false;
    const [lx, ly, rx, ry] = this.sideCells(x, y, d);
    return this.cell(lx, ly) !== this.cell(rx, ry);
  }

  degree(x: number, y: number): number {
    let degree = 0;
    for (let d = 0; d < 4; d += 1) if (this.hasEdge(x, y, d)) degree += 1;
    return degree;
  }

  private seenIndex(x: number, y: number, d: number): { readonly h: boolean; readonly i: number } {
    if (d === 0) return { h: true, i: y * this.width + x };
    if (d === 2) return { h: true, i: y * this.width + x - 1 };
    if (d === 1) return { h: false, i: y * (this.width + 1) + x };
    return { h: false, i: (y - 1) * (this.width + 1) + x };
  }

  visited(x: number, y: number, d: number): boolean {
    const s = this.seenIndex(x, y, d);
    return (s.h ? this.hSeen[s.i] : this.vSeen[s.i]) === 1;
  }

  private markVisited(x: number, y: number, d: number): void {
    const s = this.seenIndex(x, y, d);
    if (s.h) this.hSeen[s.i] = 1;
    else this.vSeen[s.i] = 1;
  }

  walk(x0: number, y0: number, d0: number): BoundaryChain {
    const xs: number[] = [x0];
    const ys: number[] = [y0];
    const dirs: number[] = [];
    const leftPixels: number[] = [];
    const rightPixels: number[] = [];
    const [flx, fly, frx, fry] = this.sideCells(x0, y0, d0);
    const left = this.cell(flx, fly);
    const right = this.cell(frx, fry);
    let x = x0;
    let y = y0;
    let d = d0;
    let closed = false;
    for (;;) {
      this.markVisited(x, y, d);
      const [lx, ly, rx, ry] = this.sideCells(x, y, d);
      dirs.push(d);
      leftPixels.push(this.pixel(lx, ly));
      rightPixels.push(this.pixel(rx, ry));
      x += DX[d] as number;
      y += DY[d] as number;
      if (this.degree(x, y) !== 2) {
        xs.push(x);
        ys.push(y);
        break;
      }
      if (x === x0 && y === y0) {
        closed = true;
        break;
      }
      xs.push(x);
      ys.push(y);
      d = this.continuation(x, y, d);
    }
    return {
      closed,
      xs: Int32Array.from(xs),
      ys: Int32Array.from(ys),
      dirs: Uint8Array.from(dirs),
      leftPixels: Int32Array.from(leftPixels),
      rightPixels: Int32Array.from(rightPixels),
      left,
      right,
    };
  }

  private continuation(x: number, y: number, incoming: number): number {
    const back = (incoming + 2) % 4;
    for (let d = 0; d < 4; d += 1) {
      if (d !== back && this.hasEdge(x, y, d)) return d;
    }
    return incoming;
  }
}

type DirectedPiece = {
  readonly chain: number;
  readonly reversed: boolean;
  readonly startVertex: number;
  readonly endVertex: number;
  /** Direction of the first crack walked and of the last one. */
  readonly startDir: number;
  readonly endDir: number;
};

/** Assemble the closed outlines of the pixel set whose region labels satisfy
 *  `inside`, keeping that set on the left of every outline. Each outline is a
 *  list of whole chains. At a vertex where the set touches itself only
 *  diagonally, the outline turns left first, so such touching areas stay
 *  separate outlines that meet at one point and never cross. */
export function assembleRegionLoops(
  chains: ReadonlyArray<BoundaryChain>,
  inside: (region: number) => boolean,
  width: number,
): LoopPiece[][] {
  const loops: LoopPiece[][] = [];
  const pieces: DirectedPiece[] = [];
  const byStart = new Map<number, number[]>();
  const vertexId = (x: number, y: number): number => y * (width + 1) + x;
  chains.forEach((chain, index) => {
    const leftIn = inside(chain.left);
    if (leftIn === inside(chain.right)) return;
    const reversed = !leftIn;
    if (chain.closed) {
      loops.push([{ chain: index, reversed }]);
      return;
    }
    const last = chain.xs.length - 1;
    const first = vertexId(chain.xs[0] as number, chain.ys[0] as number);
    const end = vertexId(chain.xs[last] as number, chain.ys[last] as number);
    const firstDir = chain.dirs[0] as number;
    const lastDir = chain.dirs[chain.dirs.length - 1] as number;
    const piece: DirectedPiece = reversed
      ? {
          chain: index,
          reversed,
          startVertex: end,
          endVertex: first,
          startDir: (lastDir + 2) % 4,
          endDir: (firstDir + 2) % 4,
        }
      : {
          chain: index,
          reversed,
          startVertex: first,
          endVertex: end,
          startDir: firstDir,
          endDir: lastDir,
        };
    const list = byStart.get(piece.startVertex);
    if (list === undefined) byStart.set(piece.startVertex, [pieces.length]);
    else list.push(pieces.length);
    pieces.push(piece);
  });
  const used = new Uint8Array(pieces.length);
  for (let start = 0; start < pieces.length; start += 1) {
    if (used[start] === 1) continue;
    const loop: LoopPiece[] = [];
    let current = start;
    for (let guard = 0; guard <= pieces.length; guard += 1) {
      const piece = pieces[current] as DirectedPiece;
      used[current] = 1;
      loop.push({ chain: piece.chain, reversed: piece.reversed });
      const next = successor(piece, byStart.get(piece.endVertex) ?? [], pieces);
      if (next < 0 || next === start || used[next] === 1) break;
      current = next;
    }
    loops.push(loop);
  }
  return loops;
}

// Turn priority relative to the incoming direction: left, straight, right.
const TURN_PRIORITY = [3, 0, 1] as const;

function successor(
  piece: DirectedPiece,
  candidates: ReadonlyArray<number>,
  pieces: ReadonlyArray<DirectedPiece>,
): number {
  for (const turn of TURN_PRIORITY) {
    const wanted = (piece.endDir + turn) % 4;
    for (const candidate of candidates) {
      if ((pieces[candidate] as DirectedPiece).startDir === wanted) return candidate;
    }
  }
  return -1;
}
