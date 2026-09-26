// The motion a .rd file commands, planned once in integer µm so the byte
// writer (rd-job-writer.ts) and the export's post-compile checks
// (io/rd/rd-preflight.ts) read the same moves.
//
// A travel or cut whose µm target equals the head's position is skipped:
// meerk40t's RDJob.jump / RDJob.mark return when dx == dy == 0 (rdjob.py
// L1563-1565, L1577-1580 at 7e82652f), and the G-code emitter never writes a
// stationary burn either (grbl-strategy.ts). A closed segment already ends on
// its first point (core/job/job.ts), so nothing is appended to close it (audit
// RU-4). The head position is unknown when the file starts, so the first
// travel is always written; after that it carries across passes and layers.

import type { CutGroup } from '../../job';
import { cutSegmentsForPass, finalPassCutSegments } from '../../job/cut-pass-segments';
import type { Vec2 } from '../../scene';
import { mmToUm } from './rd-numbers';

export type RdPoint = { readonly xUm: number; readonly yUm: number };
export type RdMotionStep = RdPoint & { readonly cut: boolean };
export type RdBoundsUm = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

/** One Ruida part (layer): its source group, its moves and their bounds. */
export type RdMotionPart = {
  readonly part: number;
  readonly group: CutGroup;
  readonly steps: ReadonlyArray<RdMotionStep>;
  readonly bounds: RdBoundsUm;
};

/** Groups with no executable cut get no part; parts are numbered from 0. */
export function planRdMotion(groups: ReadonlyArray<CutGroup>): ReadonlyArray<RdMotionPart> {
  const parts: RdMotionPart[] = [];
  let head: RdPoint | null = null;
  for (const group of groups) {
    const steps: RdMotionStep[] = [];
    const passes = Math.max(1, group.passes);
    const finalPass = finalPassCutSegments(group);
    for (let pass = 0; pass < passes; pass += 1) {
      for (const segment of cutSegmentsForPass(group, finalPass, pass, passes)) {
        head = planSegment(steps, segment.polyline, head);
      }
    }
    const bounds = stepBounds(steps);
    if (bounds !== null) parts.push({ part: parts.length, group, steps, bounds });
  }
  return parts;
}

export function unionBounds(parts: ReadonlyArray<{ readonly bounds: RdBoundsUm }>): RdBoundsUm {
  return {
    minX: Math.min(...parts.map((part) => part.bounds.minX)),
    minY: Math.min(...parts.map((part) => part.bounds.minY)),
    maxX: Math.max(...parts.map((part) => part.bounds.maxX)),
    maxY: Math.max(...parts.map((part) => part.bounds.maxY)),
  };
}

function planSegment(
  steps: RdMotionStep[],
  polyline: ReadonlyArray<Vec2>,
  head: RdPoint | null,
): RdPoint | null {
  const first = polyline[0];
  if (first === undefined || polyline.length < 2) return head;
  const start = toUm(first);
  const cuts: RdPoint[] = [];
  let at = start;
  for (let i = 1; i < polyline.length; i += 1) {
    const point = polyline[i];
    if (point === undefined) continue;
    const target = toUm(point);
    if (samePoint(target, at)) continue;
    cuts.push(target);
    at = target;
  }
  // A segment that collapses to one µm point burns nothing, so it does not
  // get a travel either (the G-code emitter drops its seek the same way).
  if (cuts.length === 0) return head;
  if (head === null || !samePoint(head, start)) steps.push({ cut: false, ...start });
  for (const cut of cuts) steps.push({ cut: true, ...cut });
  return at;
}

function stepBounds(steps: ReadonlyArray<RdMotionStep>): RdBoundsUm | null {
  if (steps.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const step of steps) {
    minX = Math.min(minX, step.xUm);
    minY = Math.min(minY, step.yUm);
    maxX = Math.max(maxX, step.xUm);
    maxY = Math.max(maxY, step.yUm);
  }
  return { minX, minY, maxX, maxY };
}

function toUm(point: Vec2): RdPoint {
  return { xUm: mmToUm(point.x), yUm: mmToUm(point.y) };
}

function samePoint(a: RdPoint, b: RdPoint): boolean {
  return a.xUm === b.xUm && a.yUm === b.yUm;
}
