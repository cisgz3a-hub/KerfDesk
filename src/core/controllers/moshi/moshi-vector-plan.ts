// The moves a Moshi vector program commands for a Line or Fill group
// (ADR-705), planned once in mils so the program writer and the post-compile
// checks read the same moves. A move whose mil target equals the head's
// position is skipped, as the Ruida plan does (rd-motion-plan.ts). A Moshi
// vector program has no laser power: a group at 0 % power keeps its path as
// laser-off moves, so nothing fires where the layer asked for none.

import type { CutGroup, FillGroup } from '../../job';
import { cutSegmentsForPass, finalPassCutSegments } from '../../job/cut-pass-segments';
import type { Vec2 } from '../../scene';
import { samePoint, toMils, type MoshiPoint, type MoshiStep } from './moshi-units';

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

/** A Fill group burns each scan segment as a vector line, with a laser-off
 *  runway of the group's overscan before and after it along the line, so the
 *  head is at speed across the burn. Runways stay on the bed side of 0. */
export function planFillGroupSteps(group: FillGroup): MoshiStep[] {
  const steps: MoshiStep[] = [];
  const fires = group.power > 0;
  const passes = Math.max(1, Math.trunc(group.passes));
  const runwayMm = Math.max(0, group.overscanMm);
  let head: MoshiPoint | null = null;
  for (let pass = 0; pass < passes; pass += 1) {
    for (const segment of group.segments) {
      const polyline = withRunways(segment.polyline, runwayMm);
      if (polyline === null) {
        head = planPolyline(steps, segment.polyline, head, fires);
        continue;
      }
      head = planPolyline(steps, polyline.burn, head, fires, polyline.entry, polyline.exit);
    }
  }
  return steps;
}

function withRunways(
  polyline: ReadonlyArray<Vec2>,
  runwayMm: number,
): { entry: Vec2; burn: ReadonlyArray<Vec2>; exit: Vec2 } | null {
  const first = polyline[0];
  const last = polyline[polyline.length - 1];
  if (runwayMm <= 0 || polyline.length !== 2 || first === undefined || last === undefined)
    return null;
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return null;
  const ux = (dx / length) * runwayMm;
  const uy = (dy / length) * runwayMm;
  return {
    entry: { x: Math.max(0, first.x - ux), y: Math.max(0, first.y - uy) },
    burn: polyline,
    exit: { x: Math.max(0, last.x + ux), y: Math.max(0, last.y + uy) },
  };
}

function planPolyline(
  steps: MoshiStep[],
  polyline: ReadonlyArray<Vec2>,
  head: MoshiPoint | null,
  fires: boolean,
  entry?: Vec2,
  exit?: Vec2,
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
  if (entry !== undefined) travel(toMils(entry));
  travel(start);
  for (const burn of burns) steps.push({ ...burn, cut: fires });
  position = at;
  if (exit !== undefined) travel(toMils(exit));
  return position;
}
