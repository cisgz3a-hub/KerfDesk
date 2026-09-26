// Minimum-feature check (ADR-408): where is cut geometry narrower than the
// kerf, beam or tool that cuts it?
//
// Local width is the diameter of a maximal inscribed disk — twice the
// inscribed radius a distance transform reads. It is computed here exactly
// from the paths rather than sampled on a raster: two boundary pieces closer
// than the threshold witness a sub-threshold feature when the disk whose
// diameter is their closest-point chord holds no other boundary. Inside a
// strip, a bridge or a small hole that disk is empty and its diameter is the
// local width. At an ordinary corner the chord cuts across the corner and the
// corner's own edges enter the disk, so corners are not features (a spike
// sharper than about 36 degrees is: its tip really is narrower than the kerf).
//
// A witness whose midpoint lies in material is a narrow PART (it burns away,
// or a pocket/inside cut cannot enter it); one whose midpoint lies outside
// every shape, or between open lines, is a narrow GAP (the cuts on each side
// merge, or an outside cut cannot fit). Witnesses that share a piece, or sit
// on consecutive pieces of one path, are one feature; features shorter than
// half the threshold are dropped as specks unless they pinch two paths (or
// two far-apart parts of one path) together. Work is counted, so a huge job
// stops early and says so.

import {
  DEFAULT_MIN_FEATURE_BUDGET,
  MinFeatureWorkMeter,
  type MinFeatureBudget,
} from './feature-budget';
import { FeatureSides } from './feature-sides';
import { FeatureClusters, type MinFeatureFindings } from './feature-clusters';
import {
  buildPieceIndex,
  cellColumn,
  cellKey,
  cellRow,
  nextPieceOnPath,
  num,
  type MinFeaturePath,
  type PieceIndex,
} from './piece-index';
import { closestSegmentPoints, pointSegmentDistSq } from './segment-distance';

export type MinFeatureRequest = {
  /** Kerf, beam or tool diameter in mm; features narrower than this are reported. */
  readonly thresholdMm: number;
  /** Report material narrower than the threshold. */
  readonly checkWidths: boolean;
  /** Report gaps between shapes or lines narrower than the threshold. */
  readonly checkGaps: boolean;
  /** Shortest feature reported, mm; default MIN_EXTENT_FACTOR × threshold. */
  readonly minExtentMm?: number;
};

export type MinFeatureAnalysis = {
  readonly widths: MinFeatureFindings;
  readonly gaps: MinFeatureFindings;
  /** False when the work budget ran out; findings cover only what was checked. */
  readonly complete: boolean;
  /** Counted work spent, in the budget's units. */
  readonly work: { readonly pieces: number; readonly pairTests: number };
};

/** A witness disk may lose this fraction of its radius to polygonisation. */
const DISK_TOLERANCE = 0.05;
/** Along one path, the boundary between the chord ends must go around the
 * witness disk: at least half its circumference, π/2 · (1 − tolerance) ≈ 1.49
 * chord lengths. Closer neighbours are the same edge or a corner. */
const NEIGHBOUR_ARC_FACTOR = 1.45;
/** Touching or crossing boundaries (zero distance) are not features. */
const TOUCH_EPSILON_MM = 1e-9;
/** Features whose witness chords span less than this many thresholds are
 * specks the beam or bit rounds off like a corner (a traced hair spike, a
 * pixel notch), not parts, bridges or gaps. A small round hole still spans
 * its own diameter, so half the threshold keeps every hole the check is for. */
export const MIN_EXTENT_FACTOR = 0.5;
/** A witness between two points of one path at least this many thresholds
 * apart along it is a pinch, never a speck: a speck's witnesses stay within
 * about one threshold of boundary around its tip. */
const PINCH_ARC_FACTOR = 2;

type Witness = {
  readonly px: number;
  readonly py: number;
  readonly mx: number;
  readonly my: number;
};

class PairScanner {
  readonly widths = new FeatureClusters();
  readonly gaps = new FeatureClusters();
  private readonly sides: FeatureSides;
  private readonly stamp: Int32Array;
  private readonly thresholdSq: number;
  // The current piece's box grown by the threshold: a cheap first reject.
  private reachMinX = 0;
  private reachMinY = 0;
  private reachMaxX = 0;
  private reachMaxY = 0;

  constructor(
    private readonly index: PieceIndex,
    private readonly request: MinFeatureRequest,
    private readonly meter: MinFeatureWorkMeter,
  ) {
    this.sides = new FeatureSides(index, meter);
    this.stamp = new Int32Array(index.count).fill(-1);
    this.thresholdSq = request.thresholdMm * request.thresholdMm;
  }

  /** False when the budget ran out before every pair was tested. */
  scan(): boolean {
    const index = this.index;
    const reach = this.request.thresholdMm;
    for (let p = 0; p < index.count; p += 1) {
      const ax = num(index.ax, p);
      const ay = num(index.ay, p);
      const bx = num(index.bx, p);
      const by = num(index.by, p);
      this.reachMinX = Math.min(ax, bx) - reach;
      this.reachMaxX = Math.max(ax, bx) + reach;
      this.reachMinY = Math.min(ay, by) - reach;
      this.reachMaxY = Math.max(ay, by) + reach;
      const c0 = cellColumn(index, this.reachMinX);
      const c1 = cellColumn(index, this.reachMaxX);
      const r0 = cellRow(index, this.reachMinY);
      const r1 = cellRow(index, this.reachMaxY);
      for (let row = r0; row <= r1; row += 1) {
        for (let column = c0; column <= c1; column += 1) {
          if (!this.scanCell(p, cellKey(index, column, row))) return false;
        }
      }
    }
    return true;
  }

  private scanCell(p: number, key: number): boolean {
    const { cellStart, cellItems } = this.index;
    const end = num(cellStart, key + 1);
    for (let slot = num(cellStart, key); slot < end; slot += 1) {
      const q = num(cellItems, slot);
      if (q <= p || this.stamp[q] === p) continue;
      this.stamp[q] = p;
      if (!this.meter.takePairTests(1)) return false;
      if (!this.withinReach(q)) continue;
      if (!this.testPair(p, q)) return false;
    }
    return true;
  }

  private withinReach(q: number): boolean {
    const index = this.index;
    const ax = num(index.ax, q);
    const bx = num(index.bx, q);
    if (Math.max(ax, bx) < this.reachMinX || Math.min(ax, bx) > this.reachMaxX) return false;
    const ay = num(index.ay, q);
    const by = num(index.by, q);
    return Math.max(ay, by) >= this.reachMinY && Math.min(ay, by) <= this.reachMaxY;
  }

  /** False only when the budget ran out mid-test. */
  private testPair(p: number, q: number): boolean {
    const index = this.index;
    const ax = num(index.ax, p);
    const ay = num(index.ay, p);
    const cx = num(index.ax, q);
    const cy = num(index.ay, q);
    const closest = closestSegmentPoints(
      ax,
      ay,
      num(index.bx, p),
      num(index.by, p),
      cx,
      cy,
      num(index.bx, q),
      num(index.by, q),
    );
    if (closest.distSq >= this.thresholdSq) return true;
    const distance = Math.sqrt(closest.distSq);
    if (distance <= TOUCH_EPSILON_MM) return true;
    const arc = this.arcBetween(p, q, closest.s, closest.t);
    // Closer along one path than going around the witness disk takes: the
    // same edge or a corner.
    if (arc < NEIGHBOUR_ARC_FACTOR * distance) return true;
    const px = ax + (num(index.bx, p) - ax) * closest.s;
    const py = ay + (num(index.by, p) - ay) * closest.s;
    const qx = cx + (num(index.bx, q) - cx) * closest.t;
    const qy = cy + (num(index.by, q) - cy) * closest.t;
    const witness: Witness = { px, py, mx: (px + qx) / 2, my: (py + qy) / 2 };
    const empty = this.diskIsEmpty(witness.mx, witness.my, (distance / 2) * (1 - DISK_TOLERANCE));
    if (empty === null) return false;
    if (!empty) return true;
    const material = this.isMaterial(p, q, witness, distance / 2);
    if (material === null) return false;
    const clusters = material ? this.widthsIfRequested() : this.gapsIfRequested();
    const pinch = arc >= PINCH_ARC_FACTOR * this.request.thresholdMm;
    clusters?.record(p, q, distance, { px, py, qx, qy }, pinch);
    return true;
  }

  private widthsIfRequested(): FeatureClusters | null {
    return this.request.checkWidths ? this.widths : null;
  }

  private gapsIfRequested(): FeatureClusters | null {
    return this.request.checkGaps ? this.gaps : null;
  }

  /** Boundary length between the chord ends along their path (the shorter
   * way round a closed one); Infinity when they are on different paths. */
  private arcBetween(p: number, q: number, s: number, t: number): number {
    const index = this.index;
    const path = num(index.path, p);
    if (path !== index.path[q]) return Infinity;
    const along = (piece: number, fraction: number): number => {
      const length = Math.hypot(
        num(index.bx, piece) - num(index.ax, piece),
        num(index.by, piece) - num(index.ay, piece),
      );
      return num(index.s0, piece) + length * fraction;
    };
    const arc = Math.abs(along(p, s) - along(q, t));
    return index.pathClosed[path] === true ? Math.min(arc, num(index.pathLength, path) - arc) : arc;
  }

  private isMaterial(p: number, q: number, witness: Witness, half: number): boolean | null {
    const index = this.index;
    const closedP = index.pathClosed[num(index.path, p)] === true;
    const closedQ = index.pathClosed[num(index.path, q)] === true;
    // Open lines enclose nothing: two of them close together are a gap.
    if (!closedP || !closedQ) return false;
    return this.sides.materialAt(p, q, witness, half);
  }

  /** True when no piece comes within `radius` of (x, y); null on budget. */
  private diskIsEmpty(x: number, y: number, radius: number): boolean | null {
    const index = this.index;
    const radiusSq = radius * radius;
    const c0 = cellColumn(index, x - radius);
    const c1 = cellColumn(index, x + radius);
    const r0 = cellRow(index, y - radius);
    const r1 = cellRow(index, y + radius);
    for (let row = r0; row <= r1; row += 1) {
      for (let column = c0; column <= c1; column += 1) {
        const key = cellKey(index, column, row);
        const end = num(index.cellStart, key + 1);
        for (let slot = num(index.cellStart, key); slot < end; slot += 1) {
          const piece = num(index.cellItems, slot);
          if (!this.meter.takePairTests(1)) return null;
          const distSq = pointSegmentDistSq(
            x,
            y,
            num(index.ax, piece),
            num(index.ay, piece),
            num(index.bx, piece),
            num(index.by, piece),
          );
          if (distSq < radiusSq) return false;
        }
      }
    }
    return true;
  }
}

const EMPTY_FINDINGS: MinFeatureFindings = { count: 0, minWidthMm: null, sites: [] };

/** Find sub-threshold parts and gaps in one operation's cut paths (mm). */
export function analyzeMinimumFeatures(
  paths: ReadonlyArray<MinFeaturePath>,
  request: MinFeatureRequest,
  budget: MinFeatureBudget = DEFAULT_MIN_FEATURE_BUDGET,
): MinFeatureAnalysis {
  const valid = Number.isFinite(request.thresholdMm) && request.thresholdMm > 0;
  if (!valid || (!request.checkWidths && !request.checkGaps)) {
    return {
      widths: EMPTY_FINDINGS,
      gaps: EMPTY_FINDINGS,
      complete: true,
      work: { pieces: 0, pairTests: 0 },
    };
  }
  const meter = new MinFeatureWorkMeter(budget);
  const index = buildPieceIndex(paths, request.thresholdMm, meter);
  const scanner = new PairScanner(index, request, meter);
  const scanned = scanner.scan();
  const minExtent = request.minExtentMm ?? MIN_EXTENT_FACTOR * request.thresholdMm;
  const next = (piece: number): number => nextPieceOnPath(index, piece);
  scanner.widths.joinAlongPaths(next);
  scanner.gaps.joinAlongPaths(next);
  return {
    widths: scanner.widths.findings(minExtent),
    gaps: scanner.gaps.findings(minExtent),
    complete: index.complete && scanned,
    work: { pieces: meter.pieces, pairTests: meter.pairTests },
  };
}

export type { MinFeatureFindings, MinFeaturePath };
