// Rotary surface speed in a Ruida .rd file (ADR-127 Amendment 5, code quality
// audit C2 D2-P1-2). export applies KerfDesk's Y scale (machineSpaceJob), so a
// stroke round the part moves the surface at speed ÷ k unless its feed is
// matched, as G-code does per move (ADR-127 Amendment 2) and the Moshiboard
// per program (ADR-705 Amendment 1). A .rd layer carries one speed, so each
// rotary layer is split into parts by speed class: every cut is classed by the
// feed that moves the surface at the layer speed, in geometric steps, and
// each class becomes its own part at that speed. No mid-layer speed command
// is relied on, since none is verified on a controller. Amendments 7 and 8:
// within a class, runs of cuts keep their path order and burn in the order
// rd-rotary-order.ts picks, short in laser-off travel and kind to the
// rotary's backlash; the strokes still burn in pieces, which Rotary Setup says.

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
import { laserOffTravelUm, nextGroup, orderedPieceSteps, type Head } from './rd-rotary-order';

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

type Class = { readonly key: number; readonly speed: number; readonly pieces: OpenPiece[] };
type OpenPiece = { readonly start: RdMotionStep; readonly cuts: RdMotionStep[] };
type Held = { readonly layerId: string; readonly speed: number; rise: number };

function splitAll(
  parts: ReadonlyArray<RdMotionPart>,
  match: RotaryFeedMatch,
  classStep: number,
): RdRotaryParts {
  const out: RdMotionPart[] = [];
  const spread = { min: Number.POSITIVE_INFINITY, max: 0 };
  const held = new Map<string, Held>();
  let head: Head = { at: null, dir: 0 };
  // Where the planner left the head before this part: planRdMotion carries it
  // across layers, so a part may open with a cut from there (audit of the last
  // 200 PRs, #1762).
  let planned: RdMotionStep | null = null;
  for (const part of parts) {
    const classes = [...classifyPart(part, planned, match, classStep, spread, held).values()].sort(
      (a, b) => a.key - b.key,
    );
    planned = part.steps[part.steps.length - 1] ?? planned;
    // ADR-127 Amd 9 (C2 verify E4-P3-3): the sweep, unless it travels clearly
    // further than the pieces' own order, which on a k > 1 roller it can.
    const sweep = sweepOrder(classes, head, part.bounds);
    const path = pathOrder(classes, head, part.bounds);
    const chosen = sweep.travelUm <= path.travelUm * SWEEP_TRAVEL_ALLOWANCE ? sweep : path;
    head = chosen.head;
    for (const group of chosen.groups) {
      out.push({
        part: out.length,
        group: { ...part.group, speed: group.speed },
        steps: group.steps,
        bounds: boundsOf(group.steps),
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

/** How much more laser-off travel the sweep may take than the pieces' own
 *  order before that order is used instead (ADR-127 Amendment 9). */
const SWEEP_TRAVEL_ALLOWANCE = 1.05;

type LayerOrder = {
  readonly groups: ReadonlyArray<{ readonly speed: number; readonly steps: RdMotionStep[] }>;
  readonly head: Head;
  readonly travelUm: number;
};

/** ADR-127 Amd 8 (C2 verify E3-P2-2): each class burns whole, its pieces in
 *  the sweep rd-rotary-order.ts makes, and the next class is the one that
 *  sweep would go on into from where the last left the head and the rotary. */
function sweepOrder(classes: ReadonlyArray<Class>, from: Head, bounds: RdBoundsUm): LayerOrder {
  const left = [...classes];
  const groups: { speed: number; steps: RdMotionStep[] }[] = [];
  let head = from;
  let travelUm = 0;
  while (left.length > 0) {
    const index = nextGroup(
      left.map((entry) => entry.pieces),
      head,
      bounds,
    );
    const [group] = left.splice(index, 1);
    if (group === undefined) break;
    const next = orderedPieceSteps(group.pieces, head, bounds);
    travelUm += laserOffTravelUm(next.steps, head.at);
    head = next.head;
    groups.push({ speed: group.speed, steps: next.steps });
  }
  return { groups, head, travelUm };
}

/** The classes in speed order and each class's pieces in path order, as
 *  before Amendment 7, each still reached past its start when it would start
 *  against the rotary. */
function pathOrder(classes: ReadonlyArray<Class>, from: Head, bounds: RdBoundsUm): LayerOrder {
  const groups: { speed: number; steps: RdMotionStep[] }[] = [];
  let head = from;
  let travelUm = 0;
  for (const group of classes) {
    const next = orderedPieceSteps(group.pieces, head, bounds, true);
    travelUm += laserOffTravelUm(next.steps, head.at);
    head = next.head;
    groups.push({ speed: group.speed, steps: next.steps });
  }
  return { groups, head, travelUm };
}

/** `entry` is where the plan left the head before this part; a part that
 *  opens with a cut burns it from there. */
function classifyPart(
  part: RdMotionPart,
  entry: RdMotionStep | null,
  match: RotaryFeedMatch,
  classStep: number,
  spread: { min: number; max: number },
  held: Map<string, Held>,
): Map<number, Class> {
  const layerFeed = part.group.speed;
  const classes = new Map<number, Class>();
  let previous: RdMotionStep | null = entry;
  let open: { key: number; piece: OpenPiece } | null = null;
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

function boundsOf(steps: ReadonlyArray<RdMotionStep>): RdBoundsUm {
  return unionBounds(
    steps.map((step) => ({
      bounds: { minX: step.xUm, minY: step.yUm, maxX: step.xUm, maxY: step.yUm },
    })),
  );
}
