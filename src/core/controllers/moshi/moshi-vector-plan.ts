// The moves a Moshi vector program commands for a Line or Fill group
// (ADR-705; a Fill goes through moshi-fill-plan.ts), planned once in mils so the program writer and the post-compile
// checks read the same moves. A move whose mil target equals the head's
// position is skipped, as the Ruida plan does (rd-motion-plan.ts). A Moshi
// vector program has no laser power: a group at 0 % power keeps its path as
// laser-off moves, so nothing fires where the layer asked for none.

import type { CutGroup } from '../../job';
import { cutSegmentsForPass, finalPassCutSegments } from '../../job/cut-pass-segments';
import type { Vec2 } from '../../scene';
import { samePoint } from '../../geometry/point-math';
import { toMils, type MoshiPoint, type MoshiStep } from './moshi-units';

export function planCutGroupSteps(group: CutGroup): MoshiStep[] {
  const steps: MoshiStep[] = [];
  const fires = group.power > 0;
  const passes = Math.max(1, Math.trunc(group.passes));
  const finalPass = finalPassCutSegments(group);
  let head: MoshiPoint | null = null;
  for (let pass = 0; pass < passes; pass += 1) {
    for (const segment of cutSegmentsForPass(group, finalPass, pass, passes)) {
      head = planPolyline(steps, segment.polyline, head, fires);
    }
  }
  return steps;
}

/** Moves for one polyline: a travel to its start unless the head is there,
 *  then its points, cut when the group fires. Returns the head after it. */
export function planPolyline(
  steps: MoshiStep[],
  polyline: ReadonlyArray<Vec2>,
  head: MoshiPoint | null,
  fires: boolean,
): MoshiPoint | null {
  const first = polyline[0];
  if (first === undefined || polyline.length < 2) return head;
  const start = toMils(first);
  const burns: MoshiPoint[] = [];
  let at = start;
  for (let i = 1; i < polyline.length; i += 1) {
    const point = polyline[i];
    if (point === undefined) continue;
    const target = toMils(point);
    if (samePoint(target, at)) continue;
    burns.push(target);
    at = target;
  }
  // A segment that collapses to one mil point burns nothing and gets no travel.
  if (burns.length === 0) return head;
  let position = head;
  const travel = (point: MoshiPoint): void => {
    if (position !== null && samePoint(position, point)) return;
    steps.push({ ...point, cut: false });
    position = point;
  };
  travel(start);
  for (const burn of burns) steps.push({ ...burn, cut: fires });
  return at;
}
