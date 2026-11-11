// The moves a Moshi vector program commands for a Fill group (ADR-705
// Amendment 4, code quality audit C2 D2-P1-3 and D2-P3-2). A Scan Line fill
// takes its sweeps from planFillSweeps, the planner the G-code Fill uses
// (grbl-fill-emission.ts), so a Moshi Fill gets the same sweeps:
// - the reversed sweeps shifted by the bidirectional scan offset (the layer's
//   value, else the machine's speed table);
// - the runway policy and its shared runway points;
// - the segment filter.
// Each sweep is walked as the G-code Fill walks it: laser-off to the runway
// start and up to the first ink, a cut across each ink span, laser-off
// across the gaps, then the exit runway. An Offset fill's contours burn as
// lines. A Moshi has no power value: a 0 % layer keeps its path laser-off.

import type { DeviceProfile } from '../../devices';
import type { FillGroup } from '../../job';
import { expandFillHatchWithRunways } from '../../job/fill-runway';
import { planFillSweeps, type FillSweepPlan } from '../../job/fill-sweep-plan';
import { offsetForSpeed } from '../../job/scan-offset';
import type { Vec2 } from '../../scene';
import { toMils, type MoshiPoint, type MoshiStep } from './moshi-units';
import { planPolyline } from './moshi-vector-plan';

/** The scan offset a reversed Fill sweep gets, resolved as on G-code. */
export function moshiFillScanOffsetMm(group: FillGroup, device: DeviceProfile): number {
  return group.bidirectionalScanOffsetMm ?? offsetForSpeed(device.scanningOffsets, group.speed);
}

export function planFillGroupSteps(group: FillGroup, device: DeviceProfile): MoshiStep[] {
  const steps: MoshiStep[] = [];
  const fires = group.power > 0;
  const passes = Math.max(1, Math.trunc(group.passes));
  if ((group.fillStyle ?? 'scanline') === 'offset') {
    let head: MoshiPoint | null = null;
    for (let pass = 0; pass < passes; pass += 1) {
      for (const segment of group.segments)
        head = planPolyline(steps, segment.polyline, head, fires);
    }
    return steps;
  }
  const plans = planFillSweeps(group, moshiFillScanOffsetMm(group, device));
  for (let pass = 0; pass < passes; pass += 1) {
    for (const plan of plans) planSweep(steps, plan, fires);
  }
  return steps;
}

function planSweep(steps: MoshiStep[], plan: FillSweepPlan, fires: boolean): void {
  const spans = plan.sweep.spans;
  const first = spans[0];
  const last = spans[spans.length - 1];
  if (first === undefined || last === undefined) return;
  const run = expandFillHatchWithRunways([first.start, last.end], plan);
  if (run === null) return;
  // A runway that would reach past the home corner stops at it: only laser-off
  // travel is shortened, never a burn.
  const push = (point: Vec2, cut: boolean): void => {
    const at = toMils(cut ? point : { x: Math.max(0, point.x), y: Math.max(0, point.y) });
    const previous = steps[steps.length - 1];
    if (previous !== undefined && previous.x === at.x && previous.y === at.y) return;
    steps.push({ ...at, cut });
  };
  push(run.leadStart, false);
  push(run.burnStart, false);
  for (const span of spans) {
    push(span.start, false);
    push(span.end, fires);
  }
  push(run.leadEnd, false);
}
