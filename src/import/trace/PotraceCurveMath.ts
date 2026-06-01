import type { PathSegment } from '../../core/scene/SceneObject';

interface PointLike {
  x: number;
  y: number;
}

export type PotraceCurveTag = 'CURVE' | 'CORNER';

export interface PotraceCurveSegment {
  tag: PotraceCurveTag;
  vertex: PointLike;
  c: [PointLike, PointLike, PointLike];
  alpha: number;
  alpha0: number;
  beta: number;
}

export interface PotraceCurve {
  segments: PotraceCurveSegment[];
  alphaCurve: boolean;
}

interface OptiCandidate {
  c: [PointLike, PointLike];
  alpha: number;
  t: number;
  s: number;
  pen: number;
}

const POTRACE_MIN_CURVE_ALPHA = 0.55;
const POTRACE_MAX_CURVE_ALPHA = 1;

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function sign(value: number): number {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

function copyPoint(point: PointLike): PointLike {
  return { x: point.x, y: point.y };
}

function interval(lambda: number, a: PointLike, b: PointLike): PointLike {
  return {
    x: a.x + lambda * (b.x - a.x),
    y: a.y + lambda * (b.y - a.y),
  };
}

function dpara(a: PointLike, b: PointLike, c: PointLike): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function cprod(p0: PointLike, p1: PointLike, p2: PointLike, p3: PointLike): number {
  return (p1.x - p0.x) * (p3.y - p2.y) - (p1.y - p0.y) * (p3.x - p2.x);
}

function iprod(p0: PointLike, p1: PointLike, p2: PointLike): number {
  return (p1.x - p0.x) * (p2.x - p0.x) + (p1.y - p0.y) * (p2.y - p0.y);
}

function iprod1(p0: PointLike, p1: PointLike, p2: PointLike, p3: PointLike): number {
  return (p1.x - p0.x) * (p3.x - p2.x) + (p1.y - p0.y) * (p3.y - p2.y);
}

function ddist(a: PointLike, b: PointLike): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function bezier(t: number, p0: PointLike, p1: PointLike, p2: PointLike, p3: PointLike): PointLike {
  const s = 1 - t;
  return {
    x: s * s * s * p0.x + 3 * s * s * t * p1.x + 3 * t * t * s * p2.x + t * t * t * p3.x,
    y: s * s * s * p0.y + 3 * s * s * t * p1.y + 3 * t * t * s * p2.y + t * t * t * p3.y,
  };
}

function tangent(
  p0: PointLike,
  p1: PointLike,
  p2: PointLike,
  p3: PointLike,
  q0: PointLike,
  q1: PointLike,
): number {
  const a0 = cprod(p0, p1, q0, q1);
  const b0 = cprod(p1, p2, q0, q1);
  const c0 = cprod(p2, p3, q0, q1);
  const a = a0 - 2 * b0 + c0;
  const b = -2 * a0 + 2 * b0;
  const c = a0;
  const determinant = b * b - 4 * a * c;
  if (a === 0 || determinant < 0) return -1;

  const root = Math.sqrt(determinant);
  const r1 = (-b + root) / (2 * a);
  const r2 = (-b - root) / (2 * a);
  if (r1 >= 0 && r1 <= 1) return r1;
  if (r2 >= 0 && r2 <= 1) return r2;
  return -1;
}

function ddenom(a: PointLike, c: PointLike): number {
  const r = {
    x: sign(c.y - a.y),
    y: -sign(c.x - a.x),
  };
  return r.y * (c.x - a.x) - r.x * (c.y - a.y);
}

function clampCurveAlpha(alpha: number): number {
  return Math.max(POTRACE_MIN_CURVE_ALPHA, Math.min(POTRACE_MAX_CURVE_ALPHA, alpha));
}

function cloneCurve(curve: PotraceCurve): PotraceCurve {
  return {
    alphaCurve: curve.alphaCurve,
    segments: curve.segments.map(segment => ({
      tag: segment.tag,
      vertex: copyPoint(segment.vertex),
      c: [copyPoint(segment.c[0]), copyPoint(segment.c[1]), copyPoint(segment.c[2])],
      alpha: segment.alpha,
      alpha0: segment.alpha0,
      beta: segment.beta,
    })),
  };
}

export function potraceAlphaForVertex(previous: PointLike, vertex: PointLike, next: PointLike): number {
  const denom = ddenom(previous, next);
  if (denom === 0) {
    return 4 / 3;
  }

  const dd = Math.abs(dpara(previous, vertex, next) / denom);
  const alpha = (dd > 1 ? 1 - 1 / dd : 0) / 0.75;
  return alpha;
}

export function smoothClosedPolygonToPotraceCurve(
  points: readonly PointLike[],
  alphaMax: number,
): PotraceCurve {
  if (points.length < 2) return { segments: [], alphaCurve: false };

  const alphaLimit = Math.max(0, alphaMax);
  const segments: PotraceCurveSegment[] = [];

  for (let index = 0; index < points.length; index++) {
    const previous = points[mod(index - 1, points.length)];
    const vertex = points[index];
    const next = points[mod(index + 1, points.length)];
    const endpoint = interval(0.5, next, vertex);
    const rawAlpha = potraceAlphaForVertex(previous, vertex, next);

    if (alphaLimit <= 0 || rawAlpha >= alphaLimit) {
      segments.push({
        tag: 'CORNER',
        vertex: copyPoint(vertex),
        c: [copyPoint(vertex), copyPoint(vertex), endpoint],
        alpha: rawAlpha,
        alpha0: rawAlpha,
        beta: 0.5,
      });
      continue;
    }

    const alpha = clampCurveAlpha(rawAlpha);
    segments.push({
      tag: 'CURVE',
      vertex: copyPoint(vertex),
      c: [
        interval(0.5 + 0.5 * alpha, previous, vertex),
        interval(0.5 + 0.5 * alpha, next, vertex),
        endpoint,
      ],
      alpha,
      alpha0: rawAlpha,
      beta: 0.5,
    });
  }

  return { segments, alphaCurve: true };
}

export function potraceCurveToPathSegments(curve: PotraceCurve): PathSegment[] {
  const m = curve.segments.length;
  if (m === 0) return [];

  const segments: PathSegment[] = [];
  segments.push({ type: 'move', to: copyPoint(curve.segments[m - 1].c[2]) });

  for (const segment of curve.segments) {
    if (segment.tag === 'CURVE') {
      segments.push({
        type: 'cubic',
        cp1: copyPoint(segment.c[0]),
        cp2: copyPoint(segment.c[1]),
        to: copyPoint(segment.c[2]),
      });
    } else {
      segments.push({ type: 'line', to: copyPoint(segment.c[1]) });
      segments.push({ type: 'line', to: copyPoint(segment.c[2]) });
    }
  }

  segments.push({ type: 'close' });
  return segments;
}

function optiPenalty(
  curve: PotraceCurve,
  start: number,
  end: number,
  optTolerance: number,
  convexity: readonly number[],
  areaCache: readonly number[],
): OptiCandidate | null {
  const m = curve.segments.length;
  const vertices = curve.segments.map(segment => segment.vertex);
  if (start === end) return null;

  const first = mod(start + 1, m);
  const conv = convexity[first];
  if (conv === 0) return null;

  const baseDistance = ddist(vertices[start], vertices[first]);
  for (let k = first; k !== end; k = mod(k + 1, m)) {
    const k1 = mod(k + 1, m);
    const k2 = mod(k + 2, m);
    if (convexity[k1] !== conv) return null;
    if (sign(cprod(vertices[start], vertices[first], vertices[k1], vertices[k2])) !== conv) return null;
    if (iprod1(vertices[start], vertices[first], vertices[k1], vertices[k2])
      < baseDistance * ddist(vertices[k1], vertices[k2]) * -0.999847695156) {
      return null;
    }
  }

  const p0 = copyPoint(curve.segments[mod(start, m)].c[2]);
  const p1 = copyPoint(vertices[first]);
  const p2 = copyPoint(vertices[mod(end, m)]);
  const p3 = copyPoint(curve.segments[mod(end, m)].c[2]);
  let area = areaCache[end] - areaCache[start];
  area -= dpara(vertices[0], curve.segments[start].c[2], curve.segments[end].c[2]) / 2;
  if (start >= end) {
    area += areaCache[m];
  }

  const a1 = dpara(p0, p1, p2);
  const a2 = dpara(p0, p1, p3);
  const a3 = dpara(p0, p2, p3);
  const a4 = a1 + a3 - a2;
  if (a2 === a1) return null;

  const t = a3 / (a3 - a4);
  const s = a2 / (a2 - a1);
  const areaFactor = a2 * t / 2;
  if (areaFactor === 0) return null;

  const ratio = area / areaFactor;
  const alpha = 2 - Math.sqrt(4 - ratio / 0.3);
  if (!Number.isFinite(alpha)) return null;

  const candidate: OptiCandidate = {
    c: [interval(t * alpha, p0, p1), interval(s * alpha, p3, p2)],
    alpha,
    t,
    s,
    pen: 0,
  };
  const newP1 = copyPoint(candidate.c[0]);
  const newP2 = copyPoint(candidate.c[1]);

  for (let k = first; k !== end; k = mod(k + 1, m)) {
    const k1 = mod(k + 1, m);
    const tangentParameter = tangent(p0, newP1, newP2, p3, vertices[k], vertices[k1]);
    if (tangentParameter < -0.5) return null;

    const point = bezier(tangentParameter, p0, newP1, newP2, p3);
    const distance = ddist(vertices[k], vertices[k1]);
    if (distance === 0) return null;

    const d1 = dpara(vertices[k], vertices[k1], point) / distance;
    if (Math.abs(d1) > optTolerance) return null;
    if (iprod(vertices[k], vertices[k1], point) < 0 || iprod(vertices[k1], vertices[k], point) < 0) {
      return null;
    }
    candidate.pen += d1 * d1;
  }

  for (let k = start; k !== end; k = mod(k + 1, m)) {
    const k1 = mod(k + 1, m);
    const tangentParameter = tangent(
      p0,
      newP1,
      newP2,
      p3,
      curve.segments[k].c[2],
      curve.segments[k1].c[2],
    );
    if (tangentParameter < -0.5) return null;

    const point = bezier(tangentParameter, p0, newP1, newP2, p3);
    const distance = ddist(curve.segments[k].c[2], curve.segments[k1].c[2]);
    if (distance === 0) return null;

    let d1 = dpara(curve.segments[k].c[2], curve.segments[k1].c[2], point) / distance;
    let d2 = dpara(curve.segments[k].c[2], curve.segments[k1].c[2], vertices[k1]) / distance;
    d2 *= 0.75 * curve.segments[k1].alpha;
    if (d2 < 0) {
      d1 = -d1;
      d2 = -d2;
    }
    if (d1 < d2 - optTolerance) return null;
    if (d1 < d2) {
      candidate.pen += (d1 - d2) * (d1 - d2);
    }
  }

  return candidate;
}

export function optimizePotraceCurve(curve: PotraceCurve, optTolerance: number): PotraceCurve {
  const tolerance = Math.max(0, optTolerance);
  const m = curve.segments.length;
  if (m < 3 || tolerance <= 0) return cloneCurve(curve);

  const vertices = curve.segments.map(segment => segment.vertex);
  const convexity = new Array<number>(m).fill(0);
  const areaCache = new Array<number>(m + 1).fill(0);

  for (let i = 0; i < m; i++) {
    convexity[i] = curve.segments[i].tag === 'CURVE'
      ? sign(dpara(vertices[mod(i - 1, m)], vertices[i], vertices[mod(i + 1, m)]))
      : 0;
  }

  let area = 0;
  const p0 = vertices[0];
  for (let i = 0; i < m; i++) {
    const next = mod(i + 1, m);
    if (curve.segments[next].tag === 'CURVE') {
      const alpha = curve.segments[next].alpha;
      area += 0.3 * alpha * (4 - alpha)
        * dpara(curve.segments[i].c[2], vertices[next], curve.segments[next].c[2]) / 2;
      area += dpara(p0, curve.segments[i].c[2], curve.segments[next].c[2]) / 2;
    }
    areaCache[i + 1] = area;
  }

  const previous = new Array<number>(m + 1).fill(-1);
  const penalty = new Array<number>(m + 1).fill(0);
  const length = new Array<number>(m + 1).fill(0);
  const opt = new Array<OptiCandidate | null>(m + 1).fill(null);

  previous[0] = -1;
  penalty[0] = 0;
  length[0] = 0;
  for (let j = 1; j <= m; j++) {
    previous[j] = j - 1;
    penalty[j] = penalty[j - 1];
    length[j] = length[j - 1] + 1;

    for (let i = j - 2; i >= 0; i--) {
      const candidate = optiPenalty(curve, i, mod(j, m), tolerance, convexity, areaCache);
      if (!candidate) break;

      if (
        length[j] > length[i] + 1 ||
        (length[j] === length[i] + 1 && penalty[j] > penalty[i] + candidate.pen)
      ) {
        previous[j] = i;
        penalty[j] = penalty[i] + candidate.pen;
        length[j] = length[i] + 1;
        opt[j] = candidate;
      }
    }
  }

  const optimizedCount = length[m];
  const optimizedSegments = new Array<PotraceCurveSegment>(optimizedCount);
  const s = new Array<number>(optimizedCount).fill(0);
  const t = new Array<number>(optimizedCount).fill(0);
  let j = m;

  for (let i = optimizedCount - 1; i >= 0; i--) {
    if (previous[j] === j - 1) {
      const source = curve.segments[mod(j, m)];
      optimizedSegments[i] = {
        tag: source.tag,
        vertex: copyPoint(source.vertex),
        c: [copyPoint(source.c[0]), copyPoint(source.c[1]), copyPoint(source.c[2])],
        alpha: source.alpha,
        alpha0: source.alpha0,
        beta: source.beta,
      };
      s[i] = 1;
      t[i] = 1;
    } else {
      const candidate = opt[j];
      if (!candidate) return cloneCurve(curve);
      const source = curve.segments[mod(j, m)];
      optimizedSegments[i] = {
        tag: 'CURVE',
        c: [copyPoint(candidate.c[0]), copyPoint(candidate.c[1]), copyPoint(source.c[2])],
        vertex: interval(candidate.s, source.c[2], vertices[mod(j, m)]),
        alpha: candidate.alpha,
        alpha0: candidate.alpha,
        beta: 0.5,
      };
      s[i] = candidate.s;
      t[i] = candidate.t;
    }
    j = previous[j];
  }

  for (let i = 0; i < optimizedCount; i++) {
    optimizedSegments[i].beta = s[i] / (s[i] + t[mod(i + 1, optimizedCount)]);
  }

  return { segments: optimizedSegments, alphaCurve: true };
}

export function smoothClosedPolygonWithPotraceAlpha(
  points: readonly PointLike[],
  alphaMax: number,
): PathSegment[] {
  return potraceCurveToPathSegments(smoothClosedPolygonToPotraceCurve(points, alphaMax));
}
