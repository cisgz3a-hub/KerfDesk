import type { PotraceCurveSegment } from './potrace-curve';
import type { OptiContext, OptimizationPlan } from './potrace-curve-optimize';
import { copyPoint, interval, mod, pointAt, segmentAt } from './potrace-curve-optimize-geometry';

export function rebuildOptimizedSegments(
  ctx: OptiContext,
  plan: OptimizationPlan,
): { segments: PotraceCurveSegment[]; s: number[]; t: number[] } | null {
  const m = ctx.curve.segments.length;
  const optimizedCount = plan.length[m] ?? 0;
  const segments = new Array<PotraceCurveSegment>(optimizedCount);
  const s = new Array<number>(optimizedCount).fill(0);
  const t = new Array<number>(optimizedCount).fill(0);
  let j = m;

  for (let i = optimizedCount - 1; i >= 0; i -= 1) {
    const previous = plan.previous[j] ?? -1;
    const rebuilt =
      previous === j - 1 ? copyOriginalSegment(ctx.curve, j) : copyOptimizedSegment(ctx, plan, j);
    if (rebuilt === null) return null;
    segments[i] = rebuilt.segment;
    s[i] = rebuilt.s;
    t[i] = rebuilt.t;
    j = previous;
  }
  return { segments, s, t };
}

function copyOriginalSegment(
  curve: OptiContext['curve'],
  j: number,
): { segment: PotraceCurveSegment; s: number; t: number } {
  const source = segmentAt(curve, mod(j, curve.segments.length));
  return {
    segment: {
      tag: source.tag,
      vertex: copyPoint(source.vertex),
      c: [copyPoint(source.c[0]), copyPoint(source.c[1]), copyPoint(source.c[2])],
      alpha: source.alpha,
      alpha0: source.alpha0,
      beta: source.beta,
    },
    s: 1,
    t: 1,
  };
}

function copyOptimizedSegment(
  ctx: OptiContext,
  plan: OptimizationPlan,
  j: number,
): { segment: PotraceCurveSegment; s: number; t: number } | null {
  const candidate = plan.opt[j];
  if (candidate === null || candidate === undefined) return null;

  const m = ctx.curve.segments.length;
  const source = segmentAt(ctx.curve, mod(j, m));
  return {
    segment: {
      tag: 'CURVE',
      c: [copyPoint(candidate.c[0]), copyPoint(candidate.c[1]), copyPoint(source.c[2])],
      vertex: interval(candidate.s, source.c[2], pointAt(ctx.vertices, mod(j, m))),
      alpha: candidate.alpha,
      alpha0: candidate.alpha,
      beta: 0.5,
    },
    s: candidate.s,
    t: candidate.t,
  };
}

export function applyOptimizedBetas(
  segments: PotraceCurveSegment[],
  s: readonly number[],
  t: readonly number[],
): boolean {
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (segment === undefined) return false;
    segments[i] = {
      ...segment,
      beta: (s[i] ?? 0) / ((s[i] ?? 0) + (t[mod(i + 1, segments.length)] ?? 0)),
    };
  }
  return true;
}
