import type { Toolpath, ToolpathStep } from '../../core/job';
import {
  stepIndexAtLength,
  toolpathCumulativeLengths,
} from '../../core/job/toolpath-cumulative-lengths';
import { dist, lerp } from '../../core/job/toolpath-math';
import type { Vec2 } from '../../core/scene';
import { displayPolylinePointIndices, displayStepIndices } from './preview-display-decimation';

/** Display commands only: no source metadata or unselected route points cross this boundary. */
export type PreviewDisplayStep =
  | { readonly kind: 'cut'; readonly polyline: ReadonlyArray<Vec2> }
  | {
      readonly kind: 'travel';
      readonly from: Vec2;
      readonly to: Vec2;
      readonly motion?: 'rapid' | 'feed';
    };

export type PreparedPreviewFrame = {
  readonly futureSteps: ReadonlyArray<PreviewDisplayStep>;
  readonly wholeSteps: ReadonlyArray<PreviewDisplayStep>;
  readonly partial: PreviewDisplayStep | null;
  readonly head: Vec2 | null;
  readonly start: Vec2 | null;
  readonly end: Vec2 | null;
};

export type PreviewFrameOptions = {
  readonly showTravel?: boolean;
  readonly showFuture?: boolean;
  readonly showEndpoints?: boolean;
};

/** Select the same route/point indices as the synchronous Preview, before any view transform. */
export function preparePreviewFrame(
  route: Toolpath,
  scrubberT: number,
  options: PreviewFrameOptions = {},
): PreparedPreviewFrame {
  if (route.totalLength === 0) return EMPTY_FRAME;
  const showTravel = options.showTravel !== false;
  const prefix = previewPrefix(route, scrubberT * route.totalLength);
  return {
    futureSteps:
      options.showFuture !== false && scrubberT < 1
        ? selectSteps(route.steps, route.steps.length, showTravel)
        : [],
    wholeSteps: selectSteps(route.steps, prefix.count, showTravel),
    partial: prefix.partial === null ? null : displayStep(prefix.partial, showTravel),
    head: scrubberT < 1 ? copyPoint(prefix.head) : null,
    start: options.showEndpoints !== false ? copyPoint(firstPoint(route.steps)) : null,
    end: options.showEndpoints !== false ? copyPoint(lastPoint(route.steps)) : null,
  };
}

const EMPTY_FRAME: PreparedPreviewFrame = {
  futureSteps: [],
  wholeSteps: [],
  partial: null,
  head: null,
  start: null,
  end: null,
};

function selectSteps(
  steps: ReadonlyArray<ToolpathStep>,
  count: number,
  showTravel: boolean,
): ReadonlyArray<PreviewDisplayStep> {
  const selected: PreviewDisplayStep[] = [];
  // Apply the original prefix's stride before omitting hidden travel/plunges.
  for (const index of displayStepIndices(count)) {
    const step = steps[index];
    if (step === undefined) continue;
    const command = displayStep(step, showTravel);
    if (command !== null) selected.push(command);
  }
  return selected;
}

function displayStep(step: ToolpathStep, showTravel: boolean): PreviewDisplayStep | null {
  if (step.kind === 'plunge') return null;
  if (step.kind === 'travel') {
    if (!showTravel) return null;
    return {
      kind: 'travel',
      from: { x: step.from.x, y: step.from.y },
      to: { x: step.to.x, y: step.to.y },
      ...(step.motion === undefined ? {} : { motion: step.motion }),
    };
  }
  const polyline: Vec2[] = [];
  for (const index of displayPolylinePointIndices(step.polyline.length)) {
    const point = step.polyline[index];
    if (point !== undefined) polyline.push({ x: point.x, y: point.y });
  }
  return { kind: 'cut', polyline };
}

// Match sliceToolpath's boundary decisions, retaining an index instead of
// allocating its potentially multi-million-element whole-prefix array.
function previewPrefix(route: Toolpath, cut: number) {
  const steps = route.steps;
  if (cut >= route.totalLength) {
    return { count: steps.length, partial: null, head: lastPoint(steps) };
  }
  if (cut <= 0) return { count: 0, partial: null, head: firstPoint(steps) };
  const cumulative = toolpathCumulativeLengths(steps);
  const count = stepIndexAtLength(cumulative, cut);
  const step = steps[count];
  if (step === undefined) return { count, partial: null, head: lastPoint(steps) };
  const consumed = count === 0 ? 0 : (cumulative[count - 1] ?? 0);
  const partial = truncateStep(step, cut - consumed);
  return { count, partial, head: stepHead(partial) };
}

// The display partial uses the same arithmetic as toolpath-slice; only the
// selected XY commands are retained in the frame. Output geometry is untouched.
function truncateStep(step: ToolpathStep, length: number): ToolpathStep {
  if (step.kind === 'travel') {
    return { ...step, to: lerp(step.from, step.to, length / step.length), length };
  }
  if (step.kind === 'plunge') {
    const t = length / step.length;
    return { ...step, toZ: step.fromZ + (step.toZ - step.fromZ) * t, length };
  }
  const polyline: Vec2[] = [];
  let remaining = length;
  for (let index = 0; index < step.polyline.length; index++) {
    const point = step.polyline[index];
    if (point === undefined) continue;
    if (index === 0) {
      polyline.push(point);
      continue;
    }
    const previous = step.polyline[index - 1];
    if (previous === undefined) continue;
    const segmentLength = dist(previous, point);
    if (remaining >= segmentLength) {
      polyline.push(point);
      remaining -= segmentLength;
      continue;
    }
    polyline.push(lerp(previous, point, remaining / segmentLength));
    break;
  }
  return { ...step, polyline, length };
}

function firstPoint(steps: ReadonlyArray<ToolpathStep>): Vec2 | null {
  const first = steps[0];
  if (first === undefined) return null;
  if (first.kind === 'travel') return first.from;
  if (first.kind === 'plunge') return first.at;
  return first.polyline[0] ?? null;
}

function lastPoint(steps: ReadonlyArray<ToolpathStep>): Vec2 | null {
  for (let index = steps.length - 1; index >= 0; index--) {
    const step = steps[index];
    if (step === undefined) continue;
    const point = stepHead(step);
    if (point !== null) return point;
  }
  return null;
}

function stepHead(step: ToolpathStep): Vec2 | null {
  if (step.kind === 'travel') return step.to;
  if (step.kind === 'plunge') return step.at;
  return step.polyline[step.polyline.length - 1] ?? null;
}

function copyPoint(point: Vec2 | null): Vec2 | null {
  return point === null ? null : { x: point.x, y: point.y };
}
