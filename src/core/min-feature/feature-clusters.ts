// Groups minimum-feature witnesses into features (ADR-408). Two witnesses that
// share a path piece describe the same bridge, strip or gap, and so do two
// flagged pieces that follow each other along a path (around a small round
// hole each witness pairs different pieces), so pieces are joined with
// union-find; each feature keeps its narrowest witness.
//
// The speck filter drops short features only when every witness is local to
// one stretch of one path (a hair spike, a pixel notch). A PINCH — a witness
// between two different paths, or between two parts of one path far apart
// along it — is never dropped however short: two holes or two parts meeting
// tip to tip span one chord, and the narrower the pinch the worse it is.

import type { Vec2 } from '../scene';

export type MinFeatureSite = {
  /** Narrowest width (or gap) of this feature, mm. */
  readonly widthMm: number;
  /** Midpoint of the narrowest witness chord, in the paths' coordinates. */
  readonly at: Vec2;
};

export type MinFeatureFindings = {
  readonly count: number;
  readonly minWidthMm: number | null;
  /** Narrowest first, at most MAX_REPORTED_SITES. */
  readonly sites: ReadonlyArray<MinFeatureSite>;
};

export const MAX_REPORTED_SITES = 20;

export type WitnessChord = {
  readonly px: number;
  readonly py: number;
  readonly qx: number;
  readonly qy: number;
};

type Best = {
  pinch: boolean;
  width: number;
  x: number;
  y: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

function merged(into: Best | undefined, from: Best): Best {
  if (into === undefined) return { ...from };
  into.pinch = into.pinch || from.pinch;
  if (from.width < into.width) {
    into.width = from.width;
    into.x = from.x;
    into.y = from.y;
  }
  into.minX = Math.min(into.minX, from.minX);
  into.minY = Math.min(into.minY, from.minY);
  into.maxX = Math.max(into.maxX, from.maxX);
  into.maxY = Math.max(into.maxY, from.maxY);
  return into;
}

export class FeatureClusters {
  private readonly parent = new Map<number, number>();
  private readonly best = new Map<number, Best>();
  private readonly flagged = new Set<number>();

  /** One witness: pieces p and q, chord ends P and Q, chord length `width`;
   * `pinch` when the pieces are on different paths or far apart along one. */
  record(p: number, q: number, width: number, chord: WitnessChord, pinch: boolean): void {
    this.union(p, q);
    this.flagged.add(p);
    this.flagged.add(q);
    const witness = {
      pinch,
      width,
      x: (chord.px + chord.qx) / 2,
      y: (chord.py + chord.qy) / 2,
      minX: Math.min(chord.px, chord.qx),
      minY: Math.min(chord.py, chord.qy),
      maxX: Math.max(chord.px, chord.qx),
      maxY: Math.max(chord.py, chord.qy),
    };
    this.best.set(p, merged(this.best.get(p), witness));
  }

  /** Join each flagged piece to the next piece along its path when that
   * piece is flagged too. Call once, after the last record. */
  joinAlongPaths(next: (piece: number) => number): void {
    for (const piece of this.flagged) {
      const following = next(piece);
      if (following >= 0 && this.flagged.has(following)) this.union(piece, following);
    }
  }

  /** Pinches, and other features whose witness chords span at least
   * `minExtent` (the diagonal of their bounding box), narrowest first. */
  findings(minExtent: number): MinFeatureFindings {
    const features = new Map<number, Best>();
    for (const [piece, best] of this.best) {
      const root = this.find(piece);
      features.set(root, merged(features.get(root), best));
    }
    const kept = [...features.values()].filter(
      (feature) =>
        feature.pinch ||
        Math.hypot(feature.maxX - feature.minX, feature.maxY - feature.minY) >= minExtent,
    );
    // Widths equal to a nanometre read as ties, so ties list left to right.
    const key = (feature: Best): number => Math.round(feature.width * 1e6);
    const sorted = kept.sort((a, b) => key(a) - key(b) || a.x - b.x || a.y - b.y);
    return {
      count: sorted.length,
      minWidthMm: sorted[0]?.width ?? null,
      sites: sorted
        .slice(0, MAX_REPORTED_SITES)
        .map((best) => ({ widthMm: best.width, at: { x: best.x, y: best.y } })),
    };
  }

  private find(piece: number): number {
    let root = piece;
    for (;;) {
      const next = this.parent.get(root);
      if (next === undefined || next === root) break;
      root = next;
    }
    // Path compression keeps later finds near-constant.
    let walk = piece;
    while (walk !== root) {
      const next = this.parent.get(walk) ?? root;
      this.parent.set(walk, root);
      walk = next;
    }
    return root;
  }

  private union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    if (rootA < rootB) this.parent.set(rootB, rootA);
    else this.parent.set(rootA, rootB);
  }
}
