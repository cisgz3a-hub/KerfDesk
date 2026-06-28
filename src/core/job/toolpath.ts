// Toolpath arc-length helpers — convert a Job into an ordered list of
// travel + cut segments with cumulative length, so the F-A8 preview
// scrubber can slice the path at any 0..1 fraction.
//
// Pure: no DOM, no clock. Math is straight Euclidean — the preview is a
// visualization, not a kinematic simulation (acceleration profiles are
// the controller's job).

import type { Vec2 } from '../scene';
import type { FillGroup, Group, Job, RasterGroup } from './job';
import { effectiveFillOverscanMm, expandFillHatchWithOverscan } from './fill-overscan';
import { groupFillSweeps, type FillSpan, type FillSweep } from './fill-sweeps';
import { offsetForSpeed, shiftAlongTravel, type ScanOffsetPoint } from './scan-offset';

const RASTER_GAP_RAPID_THRESHOLD_MM = 5;

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

export type BuildToolpathOptions = {
  readonly startPoint?: Vec2;
  readonly parkPoint?: Vec2;
  readonly scanningOffsets?: ReadonlyArray<ScanOffsetPoint>;
};

export type ToolpathDistanceSummary = {
  readonly cutMm: number;
  readonly travelMm: number;
  readonly totalMm: number;
};

export function buildToolpath(job: Job, options: BuildToolpathOptions = {}): Toolpath {
  const steps: ToolpathStep[] = [];
  let prevEnd: Vec2 | null = options.startPoint ?? null;
  for (const group of job.groups) {
    prevEnd = appendGroupSteps(steps, prevEnd, group, options);
  }
  if (options.parkPoint !== undefined && prevEnd !== null) {
    appendTravelStep(steps, prevEnd, options.parkPoint);
  }
  const totalLength = steps.reduce((sum, s) => sum + s.length, 0);
  return { steps, totalLength };
}

function appendGroupSteps(
  steps: ToolpathStep[],
  prevEnd: Vec2 | null,
  group: Group,
  options: BuildToolpathOptions,
): Vec2 | null {
  switch (group.kind) {
    case 'raster':
      return appendRasterGroupSteps(steps, prevEnd, group);
    case 'fill':
      return appendFillGroupSteps(steps, prevEnd, group, options);
    case 'cut':
      return appendContourGroupSteps(steps, prevEnd, group.segments, group.color);
  }
}

function appendFillGroupSteps(
  steps: ToolpathStep[],
  initialPrevEnd: Vec2 | null,
  group: FillGroup,
  options: BuildToolpathOptions,
): Vec2 | null {
  if ((group.fillStyle ?? 'scanline') === 'offset') {
    return appendContourGroupSteps(steps, initialPrevEnd, group.segments, group.color);
  }
  const scanOffsetMm = offsetForSpeed(options.scanningOffsets ?? [], group.speed);
  let prevEnd = initialPrevEnd;
  for (const sweep of groupFillSweeps(group.segments)) {
    const end = appendFillSweepSteps(
      steps,
      prevEnd,
      sweep,
      group.color,
      group.overscanMm,
      group.fillStyle,
      scanOffsetMm,
    );
    if (end !== null) prevEnd = end;
  }
  return prevEnd;
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

type RasterSpan = { readonly firstX: number; readonly lastX: number };

function appendRasterGroupSteps(
  steps: ToolpathStep[],
  initialPrevEnd: Vec2 | null,
  group: RasterGroup,
): Vec2 | null {
  if (!hasUsableRasterGeometry(group)) return initialPrevEnd;
  const pixelWidthMm = (group.bounds.maxX - group.bounds.minX) / group.pixelWidth;
  const pixelHeightMm = (group.bounds.maxY - group.bounds.minY) / group.pixelHeight;
  const passes = Math.max(1, Math.floor(group.passes));
  let prevEnd = initialPrevEnd;
  for (let pass = 0; pass < passes; pass += 1) {
    let emittedRowCount = 0;
    for (let y = 0; y < group.pixelHeight; y += 1) {
      const spans = rasterActiveSpans(group, y, pixelWidthMm);
      if (spans.length === 0) continue;
      const worldY = group.bounds.minY + (y + 0.5) * pixelHeightMm;
      const reverse = (group.bidirectional ?? true) && emittedRowCount % 2 === 1;
      const ordered = reverse ? [...spans].reverse() : spans;
      for (const span of ordered) {
        prevEnd = appendRasterSpanSweepSteps(steps, prevEnd, group, span, worldY, reverse);
      }
      emittedRowCount += 1;
    }
  }
  return prevEnd;
}

function hasUsableRasterGeometry(group: RasterGroup): boolean {
  return (
    group.pixelWidth > 0 &&
    group.pixelHeight > 0 &&
    group.sValues.length >= group.pixelWidth * group.pixelHeight &&
    group.bounds.maxX > group.bounds.minX &&
    group.bounds.maxY > group.bounds.minY
  );
}

function rasterActiveSpans(
  group: RasterGroup,
  y: number,
  pixelWidthMm: number,
): ReadonlyArray<RasterSpan> {
  const rowStart = y * group.pixelWidth;
  const spans: RasterSpan[] = [];
  let firstX = -1;
  let lastInk = -1;
  for (let x = 0; x < group.pixelWidth; x += 1) {
    if ((group.sValues[rowStart + x] ?? 0) <= 0) continue;
    if (firstX === -1) {
      firstX = x;
      lastInk = x;
      continue;
    }
    const gapMm = (x - lastInk - 1) * pixelWidthMm;
    if (gapMm > RASTER_GAP_RAPID_THRESHOLD_MM) {
      spans.push({ firstX, lastX: lastInk });
      firstX = x;
    }
    lastInk = x;
  }
  if (firstX !== -1) spans.push({ firstX, lastX: lastInk });
  return spans;
}

function appendRasterSpanSweepSteps(
  steps: ToolpathStep[],
  prevEnd: Vec2 | null,
  group: RasterGroup,
  span: RasterSpan,
  worldY: number,
  reverse: boolean,
): Vec2 {
  const pixelWidthMm = (group.bounds.maxX - group.bounds.minX) / group.pixelWidth;
  const activeStartX = group.bounds.minX + span.firstX * pixelWidthMm;
  const activeEndX = group.bounds.minX + (span.lastX + 1) * pixelWidthMm;
  const overscanMm = Math.max(0, group.overscanMm);
  const rowShiftX = reverse ? -(group.bidirectionalScanOffsetMm ?? 0) : 0;
  const leadStart = {
    x: (reverse ? activeEndX + overscanMm : activeStartX - overscanMm) + rowShiftX,
    y: worldY,
  };
  const burnStart = {
    x: (reverse ? activeEndX : activeStartX) + rowShiftX,
    y: worldY,
  };
  const burnEnd = {
    x: (reverse ? activeStartX : activeEndX) + rowShiftX,
    y: worldY,
  };
  const leadEnd = {
    x: (reverse ? activeStartX - overscanMm : activeEndX + overscanMm) + rowShiftX,
    y: worldY,
  };
  appendTravelStep(steps, prevEnd, leadStart);
  appendTravelStep(steps, leadStart, burnStart);
  steps.push({
    kind: 'cut',
    color: group.color,
    polyline: [burnStart, burnEnd],
    length: dist(burnStart, burnEnd),
  });
  appendTravelStep(steps, burnEnd, leadEnd);
  return leadEnd;
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
  fillStyle: FillGroup['fillStyle'],
  scanOffsetMm: number,
): Vec2 | null {
  const spans = scanOffsetSpans(sweep, scanOffsetMm);
  const first = spans[0];
  const last = spans[spans.length - 1];
  if (first === undefined || last === undefined) return null;
  const overscan = effectiveFillOverscanMm([first.start, last.end], overscanMm, fillStyle);
  const run = expandFillHatchWithOverscan([first.start, last.end], overscan);
  if (run === null) return null;
  appendTravelStep(steps, prevEnd, run.leadStart);
  appendTravelStep(steps, run.leadStart, run.burnStart);
  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i];
    if (span === undefined) continue;
    steps.push({
      kind: 'cut',
      color,
      polyline: [span.start, span.end],
      length: dist(span.start, span.end),
    });
    const next = spans[i + 1];
    if (next !== undefined) appendTravelStep(steps, span.end, next.start);
  }
  appendTravelStep(steps, run.burnEnd, run.leadEnd);
  return run.leadEnd;
}

function scanOffsetSpans(sweep: FillSweep, scanOffsetMm: number): ReadonlyArray<FillSpan> {
  if (!sweep.reverse || scanOffsetMm === 0) return sweep.spans;
  return sweep.spans.map((span) => {
    const shifted = shiftAlongTravel(span.start, span.end, scanOffsetMm);
    return { start: shifted.from, end: shifted.to };
  });
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
