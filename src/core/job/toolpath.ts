// buildToolpath — convert a Job into an ordered list of travel + cut steps
// with cumulative length, so the F-A8 preview scrubber can slice the path at
// any 0..1 fraction.
//
// Pure: no DOM, no clock. Math is straight Euclidean — the preview is a
// visualization, not a kinematic simulation (acceleration profiles are the
// controller's job).
//
// Phase H.2 split: shared types live in toolpath-types.ts, math primitives in
// toolpath-math.ts, raster sweeps in toolpath-raster-steps.ts, and slicing in
// toolpath-slice.ts. This file keeps the build entry point and the fill /
// contour / cnc branches, and re-exports the public surface so existing
// './toolpath' importers are untouched.

import type { Vec2 } from '../scene';
import { cncPassXyPoints, type FillGroup, type Group, type Job } from './job';
import { effectiveFillOverscanMm, expandFillHatchWithOverscan } from './fill-overscan';
import { groupFillSweeps, type FillSpan, type FillSweep } from './fill-sweeps';
import { offsetForSpeed, shiftAlongTravel } from './scan-offset';
import { appendTravelStep, dist, polylineLength } from './toolpath-math';
import { appendRasterGroupSteps } from './toolpath-raster-steps';
import type {
  BuildToolpathOptions,
  Toolpath,
  ToolpathDistanceSummary,
  ToolpathStep,
} from './toolpath-types';

export type {
  BuildToolpathOptions,
  RasterToolpathSource,
  SlicedToolpath,
  Toolpath,
  ToolpathDistanceSummary,
  ToolpathStep,
} from './toolpath-types';
export { sliceToolpath } from './toolpath-slice';

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
    case 'cnc': {
      // Depth passes flatten into the 2D preview: each pass renders as a cut
      // polyline with travel between pass start points (Z is not visualized).
      const passes = group.passes.map((pass) => ({ polyline: cncPassXyPoints(pass) }));
      return appendContourGroupSteps(steps, prevEnd, passes, group.color);
    }
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
      group.islandMotionPolicy,
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
  islandMotionPolicy: FillGroup['islandMotionPolicy'],
  scanOffsetMm: number,
): Vec2 | null {
  const spans = scanOffsetSpans(sweep, scanOffsetMm);
  const first = spans[0];
  const last = spans[spans.length - 1];
  if (first === undefined || last === undefined) return null;
  const overscan = effectiveFillOverscanMm(
    [first.start, last.end],
    overscanMm,
    fillStyle,
    islandMotionPolicy,
  );
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
