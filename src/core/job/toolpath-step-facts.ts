// The few numbers a whole-route summary needs from each step: its kind, its
// length, a travel's tagged motion, whether a plunge goes down, and how many
// segments it draws.
//
// Distance totals, the Preview timeline, the pass stepper and the display
// decimation notice each walk every step of the route. Over a packed route a
// walk through `ToolpathStepList` builds a step object and a polyline array
// per index, which at a few hundred thousand steps held the UI thread for most
// of a second (performance audit S1-P2-1). This reads the columns instead, and
// reads a plain array's fields in place.

import { readPackedStepFacts, type PackedStepFacts } from './packed-toolpath';
import { packedToolpathOf } from './packed-toolpath-steps';
import type { ToolpathStepList } from './toolpath-steps';

export type ToolpathStepFacts = Readonly<PackedStepFacts>;

/**
 * Visit every step's facts in order. The facts record is reused between
 * calls, so a visitor copies what it keeps rather than the record itself.
 */
export function visitToolpathStepFacts(
  steps: ToolpathStepList,
  visit: (facts: ToolpathStepFacts, index: number) => void,
): void {
  const facts: PackedStepFacts = {
    kind: 'travel',
    length: 0,
    motion: undefined,
    descends: false,
    segmentCount: 0,
  };
  const packed = packedToolpathOf(steps);
  if (packed !== null) {
    for (let index = 0; index < steps.length; index += 1) {
      readPackedStepFacts(packed, index, facts);
      visit(facts, index);
    }
    return;
  }
  steps.forEach((step, index) => {
    facts.kind = step.kind;
    facts.length = step.length;
    facts.motion = step.kind === 'travel' ? step.motion : undefined;
    facts.descends = step.kind === 'plunge' && step.toZ < step.fromZ;
    facts.segmentCount =
      step.kind === 'travel'
        ? 1
        : step.kind === 'plunge'
          ? 0
          : Math.max(0, step.polyline.length - 1);
    visit(facts, index);
  });
}
