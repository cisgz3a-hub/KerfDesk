// Rotary surface speed in a Ruida .rd file (ADR-127 Amendment 5, code quality
// audit C2 D2-P1-2). export applies KerfDesk's Y scale (machineSpaceJob), so a
// stroke round the part moves the surface at speed ÷ k unless its feed is
// matched, as G-code does per move (ADR-127 Amendment 2) and the Moshiboard
// per program (ADR-705 Amendment 1). A .rd layer carries one speed, so each
// rotary layer is split into parts by speed class: every cut is classed by the
// feed that moves the surface at the layer speed, in geometric steps, and
// each class becomes its own part at that speed. Moves keep their order within
// a part; a part reaches each of its cuts by a laser-off move. No mid-layer
// speed command is relied on, since none is verified on a controller.

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

export type RdRotaryParts = {
  readonly parts: ReadonlyArray<RdMotionPart>;
  /** The lowest and highest dose any cut gets, as a share of the set dose. */
  readonly minDose: number;
  readonly maxDose: number;
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

type Class = { readonly speed: number; readonly steps: RdMotionStep[]; at: RdMotionStep | null };

function splitAll(
  parts: ReadonlyArray<RdMotionPart>,
  match: RotaryFeedMatch,
  classStep: number,
): RdRotaryParts {
  const out: RdMotionPart[] = [];
  let minDose = Number.POSITIVE_INFINITY;
  let maxDose = 0;
  for (const part of parts) {
    const layerFeed = part.group.speed;
    const classes = new Map<number, Class>();
    let previous: RdMotionStep | null = null;
    for (const step of part.steps) {
      if (step.cut && previous !== null) {
        const { key, speed, dose } = classify(previous, step, layerFeed, match, classStep);
        minDose = Math.min(minDose, dose);
        maxDose = Math.max(maxDose, dose);
        const target = classes.get(key) ?? { speed, steps: [], at: null };
        classes.set(key, target);
        if (target.at === null || !samePoint(target.at, previous)) {
          target.steps.push({ xUm: previous.xUm, yUm: previous.yUm, cut: false });
        }
        target.steps.push(step);
        target.at = step;
      }
      previous = step;
    }
    for (const { speed, steps } of classes.values()) {
      out.push({
        part: out.length,
        group: { ...part.group, speed },
        steps,
        bounds: boundsOf(steps),
      });
    }
  }
  return {
    parts: out,
    minDose: Number.isFinite(minDose) ? minDose : 1,
    maxDose: maxDose || 1,
  };
}

function classify(
  from: RdMotionStep,
  to: RdMotionStep,
  layerFeed: number,
  match: RotaryFeedMatch,
  classStep: number,
): { readonly key: number; readonly speed: number; readonly dose: number } {
  const a = { x: from.xUm / 1000, y: from.yUm / 1000 };
  const b = { x: to.xUm / 1000, y: to.yUm / 1000 };
  const held = surfaceMatchedFeed(layerFeed, a, b, match);
  // The feed that would move the surface at the layer speed, before any hold.
  const wanted = held * surfaceFeedDoseRise(layerFeed, a, b, match);
  const key = Math.round(Math.log(held / layerFeed) / Math.log(classStep));
  const speed = Math.min(layerFeed * classStep ** key, Math.max(layerFeed, match.maxFeedMmPerMin));
  return { key, speed, dose: wanted / speed };
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
