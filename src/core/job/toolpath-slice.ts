// Toolpath slicing — cut the step list at an arc-length fraction so the
// preview scrubber can render a partial job with the head position. Split
// from toolpath.ts (Phase H.2 refactor).

import type { Vec2 } from '../scene';
import { dist, lerp } from './toolpath-math';
import type { SlicedToolpath, Toolpath, ToolpathStep } from './toolpath-types';

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
    return { ...step, to, length };
  }
  if (step.kind === 'plunge') {
    const t = length / step.length;
    return { ...step, toZ: step.fromZ + (step.toZ - step.fromZ) * t, length };
  }
  const partial = truncatePolyline(step.polyline, length);
  return {
    ...step,
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

function headOf(step: ToolpathStep): Vec2 | null {
  if (step.kind === 'travel') return step.to;
  if (step.kind === 'plunge') return step.at;
  return step.polyline[step.polyline.length - 1] ?? null;
}

function firstHead(steps: ReadonlyArray<ToolpathStep>): Vec2 | null {
  const first = steps[0];
  if (first === undefined) return null;
  if (first.kind === 'travel') return first.from;
  if (first.kind === 'plunge') return first.at;
  return first.polyline[0] ?? null;
}

function lastHead(steps: ReadonlyArray<ToolpathStep>): Vec2 | null {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i];
    if (step === undefined) continue;
    const head = headOf(step);
    if (head !== null) return head;
  }
  return null;
}
