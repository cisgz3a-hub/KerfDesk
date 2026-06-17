// Toolpath arc-length helpers — convert a Job into an ordered list of
// travel + cut segments with cumulative length, so the F-A8 preview
// scrubber can slice the path at any 0..1 fraction.
//
// Pure: no DOM, no clock. Math is straight Euclidean — the preview is a
// visualization, not a kinematic simulation (acceleration profiles are
// the controller's job).

import type { Vec2 } from '../scene';
import type { Job } from './job';
import { effectiveOverscanMm, expandFillHatchWithOverscan } from './fill-overscan';
import { groupFillSweeps, type FillSweep } from './fill-sweeps';

export type ToolpathStep =
  | { readonly kind: 'travel'; readonly from: Vec2; readonly to: Vec2; readonly length: number }
  | {
      readonly kind: 'cut';
      readonly color: string;
      readonly polyline: ReadonlyArray<Vec2>;
      readonly length: number;
    };

export type Toolpath = {
  readonly steps: ReadonlyArray<ToolpathStep>;
  readonly totalLength: number;
};

export type ToolpathDistanceSummary = {
  readonly cutMm: number;
  readonly travelMm: number;
  readonly totalMm: number;
};

export function buildToolpath(job: Job): Toolpath {
  const steps: ToolpathStep[] = [];
  let prevEnd: Vec2 | null = null;
  for (const group of job.groups) {
    // F.2.d: the preview scrubber walks vector cuts/travels. Raster
    // groups don't have a meaningful "edge" model for the scrubber
    // (they're a continuous sweep); skip them for now. Future
    // enhancement: synthesize one "raster" step per row.
    if (group.kind === 'raster') continue;
    if (group.kind === 'fill') {
      if ((group.fillStyle ?? 'scanline') === 'offset') {
        prevEnd = appendContourGroupSteps(steps, prevEnd, group.segments, group.color);
        continue;
      }
      for (const sweep of groupFillSweeps(group.segments)) {
        const end = appendFillSweepSteps(steps, prevEnd, sweep, group.color, group.overscanMm);
        if (end !== null) prevEnd = end;
      }
      continue;
    }
    for (const seg of group.segments) {
      const first = seg.polyline[0];
      if (first === undefined) continue;
      appendTravelStep(steps, prevEnd, first);
      steps.push({
        kind: 'cut',
        color: group.color,
        polyline: seg.polyline,
        length: polylineLength(seg.polyline),
      });
      const last = seg.polyline[seg.polyline.length - 1];
      if (last !== undefined) prevEnd = last;
    }
  }
  const totalLength = steps.reduce((sum, s) => sum + s.length, 0);
  return { steps, totalLength };
}

function appendContourGroupSteps(
  steps: ToolpathStep[],
  initialPrevEnd: Vec2 | null,
  segments: ReadonlyArray<{ readonly polyline: ReadonlyArray<Vec2> }>,
  color: string,
): Vec2 | null {
  let prevEnd = initialPrevEnd;
  for (const seg of segments) {
    const first = seg.polyline[0];
    if (first === undefined) continue;
    appendTravelStep(steps, prevEnd, first);
    steps.push({
      kind: 'cut',
      color,
      polyline: seg.polyline,
      length: polylineLength(seg.polyline),
    });
    const last = seg.polyline[seg.polyline.length - 1];
    if (last !== undefined) prevEnd = last;
  }
  return prevEnd;
}

export function summarizeToolpathDistances(toolpath: Toolpath): ToolpathDistanceSummary {
  let cutMm = 0;
  let travelMm = 0;
  for (const step of toolpath.steps) {
    if (step.kind === 'cut') cutMm += step.length;
    else travelMm += step.length;
  }
  return { cutMm, travelMm, totalMm: cutMm + travelMm };
}

// One fill scanline as preview steps matching the emitted continuous sweep
// (ADR-034): travel into the optional overscan runway, then each ink span is a
// cut and each interior gap is a laser-off travel. Returns the new head
// position, or null if the sweep was degenerate.
function appendFillSweepSteps(
  steps: ToolpathStep[],
  prevEnd: Vec2 | null,
  sweep: FillSweep,
  color: string,
  overscanMm: number,
): Vec2 | null {
  const first = sweep.spans[0];
  const last = sweep.spans[sweep.spans.length - 1];
  if (first === undefined || last === undefined) return null;
  const overscan = effectiveOverscanMm([first.start, last.end], overscanMm);
  const run = expandFillHatchWithOverscan([first.start, last.end], overscan);
  if (run === null) return null;
  appendTravelStep(steps, prevEnd, run.leadStart);
  appendTravelStep(steps, run.leadStart, run.burnStart);
  for (let i = 0; i < sweep.spans.length; i += 1) {
    const span = sweep.spans[i];
    if (span === undefined) continue;
    steps.push({
      kind: 'cut',
      color,
      polyline: [span.start, span.end],
      length: dist(span.start, span.end),
    });
    const next = sweep.spans[i + 1];
    if (next !== undefined) appendTravelStep(steps, span.end, next.start);
  }
  appendTravelStep(steps, run.burnEnd, run.leadEnd);
  return run.leadEnd;
}

function appendTravelStep(steps: ToolpathStep[], from: Vec2 | null, to: Vec2): void {
  if (from === null || (from.x === to.x && from.y === to.y)) return;
  steps.push({
    kind: 'travel',
    from,
    to,
    length: dist(from, to),
  });
}

// Slice the toolpath at arc-length `cut`. Returns the steps to render whole,
// the partial step (if the cut lands mid-segment) with its truncated geometry,
// and the head position (where the laser is at that point).
export type SlicedToolpath = {
  readonly whole: ReadonlyArray<ToolpathStep>;
  readonly partial: ToolpathStep | null;
  readonly head: Vec2 | null;
};

export function sliceToolpath(toolpath: Toolpath, cut: number): SlicedToolpath {
  if (cut >= toolpath.totalLength) {
    const last = lastHead(toolpath.steps);
    return { whole: toolpath.steps, partial: null, head: last };
  }
  if (cut <= 0) return { whole: [], partial: null, head: firstHead(toolpath.steps) };
  let remaining = cut;
  const whole: ToolpathStep[] = [];
  for (const step of toolpath.steps) {
    if (remaining >= step.length) {
      whole.push(step);
      remaining -= step.length;
      continue;
    }
    // remaining < step.length — partial step
    const partial = truncateStep(step, remaining);
    return { whole, partial, head: headOf(partial) };
  }
  // Exact match on the last step — equivalent to "render all".
  return { whole, partial: null, head: lastHead(toolpath.steps) };
}

function truncateStep(step: ToolpathStep, length: number): ToolpathStep {
  if (step.kind === 'travel') {
    const to = lerp(step.from, step.to, length / step.length);
    return { kind: 'travel', from: step.from, to, length };
  }
  const partial = truncatePolyline(step.polyline, length);
  return {
    kind: 'cut',
    color: step.color,
    polyline: partial,
    length,
  };
}

function truncatePolyline(polyline: ReadonlyArray<Vec2>, length: number): ReadonlyArray<Vec2> {
  const out: Vec2[] = [];
  let remaining = length;
  for (let i = 0; i < polyline.length; i += 1) {
    const p = polyline[i];
    if (p === undefined) continue;
    if (i === 0) {
      out.push(p);
      continue;
    }
    const prev = polyline[i - 1];
    if (prev === undefined) continue;
    const segLen = dist(prev, p);
    if (remaining >= segLen) {
      out.push(p);
      remaining -= segLen;
      continue;
    }
    out.push(lerp(prev, p, remaining / segLen));
    return out;
  }
  return out;
}

function polylineLength(polyline: ReadonlyArray<Vec2>): number {
  let len = 0;
  for (let i = 1; i < polyline.length; i += 1) {
    const a = polyline[i - 1];
    const b = polyline[i];
    if (a === undefined || b === undefined) continue;
    len += dist(a, b);
  }
  return len;
}

function dist(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.hypot(dx, dy);
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function headOf(step: ToolpathStep): Vec2 | null {
  if (step.kind === 'travel') return step.to;
  return step.polyline[step.polyline.length - 1] ?? null;
}

function firstHead(steps: ReadonlyArray<ToolpathStep>): Vec2 | null {
  const first = steps[0];
  if (first === undefined) return null;
  return first.kind === 'travel' ? first.from : (first.polyline[0] ?? null);
}

function lastHead(steps: ReadonlyArray<ToolpathStep>): Vec2 | null {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const head = headOf(steps[i] as ToolpathStep);
    if (head !== null) return head;
  }
  return null;
}
