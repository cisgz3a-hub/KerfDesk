// Rotary surface speed in a Ruida .rd file (ADR-127 Amendment 5, code quality
// audit C2 D2-P1-2). export applies KerfDesk's Y scale (machineSpaceJob), so a
// stroke round the part moves the surface at speed ÷ k unless its feed is
// matched, as G-code does per move (ADR-127 Amendment 2) and the Moshiboard
// per program (ADR-705 Amendment 1). A .rd layer carries one speed, so each
// rotary layer is split into parts by speed class: every cut is classed by the
// feed that moves the surface at the layer speed, in geometric steps, and
// each class becomes its own part at that speed. No mid-layer speed command
// is relied on, since none is verified on a controller. Amendment 7: within a
// class, runs of cuts keep their path order and are burned nearest first,
// each from its nearer end, so the laser-off travel between pieces stays
// short; the strokes still burn in pieces, which Rotary Setup says.

import {
  surfaceFeedDoseRise,
  surfaceMatchedFeed,
  type RotaryFeedMatch,
} from '../../output/rotary-surface-feed';
import {
  unionBounds,
  type RdBoundsUm,
  type RdMotionPart,
  type RdMotionStep,
} from './rd-motion-plan';

/** Speed classes tried in turn, as the ratio between neighbouring classes. */
const CLASS_STEPS = [1.05, 1.1, 1.2] as const;

/** What the speed classes and the Max feed leave of the set dose. */
export type RdRotaryDose = Pick<RdRotaryParts, 'minDose' | 'maxDose' | 'held'>;

export type RdRotaryParts = {
  readonly parts: ReadonlyArray<RdMotionPart>;
  /** The lowest and highest dose the speed classes leave, as a share of the set dose. */
  readonly minDose: number;
  readonly maxDose: number;
  /** Layers whose strokes round the part the Max feed holds back (ADR-127 Amd 7). */
  readonly held: ReadonlyArray<{
    readonly layerId: string;
    readonly speed: number;
    readonly rise: number;
  }>;
};

/** The parts split by surface-matched speed, in the finest classes that fit
 *  `maxParts`; null when even the coarsest does not. */
export function splitRdPartsBySurfaceSpeed(
  parts: ReadonlyArray<RdMotionPart>,
  match: RotaryFeedMatch,
  maxParts: number,
): RdRotaryParts | null {
  for (const classStep of CLASS_STEPS) {
    const split = splitAll(parts, match, classStep);
    if (split.parts.length <= maxParts) return split;
  }
  return null;
}

/** A run of consecutive cuts in one speed class, in path order. */
type Piece = { readonly start: RdMotionStep; readonly cuts: RdMotionStep[] };
type Class = { readonly key: number; readonly speed: number; readonly pieces: Piece[] };
type Held = { readonly layerId: string; readonly speed: number; rise: number };

function splitAll(
  parts: ReadonlyArray<RdMotionPart>,
  match: RotaryFeedMatch,
  classStep: number,
): RdRotaryParts {
  const out: RdMotionPart[] = [];
  const spread = { min: Number.POSITIVE_INFINITY, max: 0 };
  const held = new Map<string, Held>();
  for (const part of parts) {
    const classes = classifyPart(part, match, classStep, spread, held);
    // ADR-127 Amd 7 (C2 verify E1-P2-2): classes in speed order, each
    // burning its pieces nearest first from where the last class ended, so
    // the laser-off travel between pieces is as short as this order allows.
    const ordered = [...classes.values()].sort((a, b) => a.key - b.key);
    let at: RdMotionStep | null = null;
    for (const group of ordered) {
      const { steps, end } = nearestFirstSteps(group.pieces, at);
      at = end;
      out.push({
        part: out.length,
        group: { ...part.group, speed: group.speed },
        steps,
        bounds: boundsOf(steps),
      });
    }
  }
  return {
    parts: out,
    minDose: Number.isFinite(spread.min) ? spread.min : 1,
    maxDose: spread.max || 1,
    held: [...held.values()].filter((entry) => Math.round(entry.rise * 100) > 100),
  };
}

function classifyPart(
  part: RdMotionPart,
  match: RotaryFeedMatch,
  classStep: number,
  spread: { min: number; max: number },
  held: Map<string, Held>,
): Map<number, Class> {
  const layerFeed = part.group.speed;
  const classes = new Map<number, Class>();
  let previous: RdMotionStep | null = null;
  let open: { key: number; piece: Piece } | null = null;
  for (const step of part.steps) {
    if (!step.cut || previous === null) {
      open = null;
      previous = step;
      continue;
    }
    const cut = classify(previous, step, layerFeed, match, classStep);
    spread.min = Math.min(spread.min, cut.classDose);
    spread.max = Math.max(spread.max, cut.classDose);
    noteHold(held, part.group.layerId, layerFeed, cut.holdRise);
    if (open === null || open.key !== cut.key) {
      const target = classes.get(cut.key) ?? { key: cut.key, speed: cut.speed, pieces: [] };
      classes.set(cut.key, target);
      open = { key: cut.key, piece: { start: previous, cuts: [] } };
      target.pieces.push(open.piece);
    }
    open.piece.cuts.push(step);
    previous = step;
  }
  return classes;
}

function noteHold(held: Map<string, Held>, layerId: string, speed: number, rise: number): void {
  if (rise <= 1) return;
  const seen = held.get(layerId);
  if (seen === undefined) held.set(layerId, { layerId, speed, rise });
  else seen.rise = Math.max(seen.rise, rise);
}

/** A class's pieces in nearest-first order from `from`, each burned from
 *  whichever end is nearer (a vector stroke marks the same either way) and
 *  reached by a laser-off move unless it starts where the last one ended. */
function nearestFirstSteps(
  pieces: ReadonlyArray<Piece>,
  from: RdMotionStep | null,
): { readonly steps: RdMotionStep[]; readonly end: RdMotionStep | null } {
  const left = [...pieces];
  const steps: RdMotionStep[] = [];
  let at = from;
  while (left.length > 0) {
    const { index, piece } = nearestPiece(left, at);
    left.splice(index, 1);
    if (at === null || !samePoint(at, piece.start)) {
      steps.push({ xUm: piece.start.xUm, yUm: piece.start.yUm, cut: false });
    }
    for (const cut of piece.cuts) steps.push(cut);
    at = piece.cuts[piece.cuts.length - 1] ?? piece.start;
  }
  return { steps, end: at };
}

function nearestPiece(
  pieces: ReadonlyArray<Piece>,
  at: RdMotionStep | null,
): { readonly index: number; readonly piece: Piece } {
  let best = { index: 0, piece: pieces[0] as Piece, distance: Number.POSITIVE_INFINITY };
  pieces.forEach((piece, index) => {
    if (at === null) {
      if (index === 0) best = { index, piece, distance: 0 };
      return;
    }
    const reversed = reversedPiece(piece);
    for (const candidate of [piece, reversed]) {
      const distance = Math.hypot(candidate.start.xUm - at.xUm, candidate.start.yUm - at.yUm);
      if (distance < best.distance) best = { index, piece: candidate, distance };
    }
  });
  return best;
}

function reversedPiece(piece: Piece): Piece {
  const points = [piece.start, ...piece.cuts].reverse();
  const [start, ...rest] = points;
  return { start: start ?? piece.start, cuts: rest.map((point) => ({ ...point, cut: true })) };
}

function classify(
  from: RdMotionStep,
  to: RdMotionStep,
  layerFeed: number,
  match: RotaryFeedMatch,
  classStep: number,
): {
  readonly key: number;
  readonly speed: number;
  readonly classDose: number;
  readonly holdRise: number;
} {
  const a = { x: from.xUm / 1000, y: from.yUm / 1000 };
  const b = { x: to.xUm / 1000, y: to.yUm / 1000 };
  const held = surfaceMatchedFeed(layerFeed, a, b, match);
  const key = Math.round(Math.log(held / layerFeed) / Math.log(classStep));
  const speed = Math.min(layerFeed * classStep ** key, Math.max(layerFeed, match.maxFeedMmPerMin));
  // The Max feed's hold and the class's rounding, apart, so each is named for
  // what it is (E1-P3-2).
  return {
    key,
    speed,
    classDose: held / speed,
    holdRise: surfaceFeedDoseRise(layerFeed, a, b, match),
  };
}

function samePoint(a: RdMotionStep, b: RdMotionStep): boolean {
  return a.xUm === b.xUm && a.yUm === b.yUm;
}

function boundsOf(steps: ReadonlyArray<RdMotionStep>): RdBoundsUm {
  return unionBounds(
    steps.map((step) => ({
      bounds: { minX: step.xUm, minY: step.yUm, maxX: step.xUm, maxY: step.yUm },
    })),
  );
}
