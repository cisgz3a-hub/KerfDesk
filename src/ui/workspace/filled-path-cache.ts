import type { Polyline, Transform } from '../../core/scene';
import type { ViewTransform } from './view-transform';

type Entry = {
  readonly pathConstructor: typeof Path2D;
  readonly points: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly errorX: number;
  readonly errorY: number;
  path: Path2D | null;
};

type Matrix = readonly [number, number, number, number, number, number];

/** Bound native retention without keeping the immutable source arrays alive. */
export class FilledPathCache {
  private readonly bySource = new WeakMap<ReadonlyArray<Polyline>, Entry>();
  private readonly recent = new Set<Entry>();
  private retainedPoints = 0;

  constructor(
    private readonly maxPoints = 1_000_000,
    private readonly maxEntries = 8,
  ) {}

  get(polylines: ReadonlyArray<Polyline>, PathCtor: typeof Path2D, matrix?: Matrix): Path2D | null {
    const cached = this.bySource.get(polylines);
    if (cached?.pathConstructor === PathCtor && cached.path !== null) {
      this.recent.delete(cached);
      this.recent.add(cached);
      return preciseEnough(cached, matrix) ? cached.path : null;
    }
    if (cached !== undefined) this.drop(cached);
    const entry = compilePath(polylines, PathCtor);
    this.bySource.set(polylines, entry);
    this.recent.add(entry);
    this.retainedPoints += entry.points;
    const path = entry.path;
    this.trim();
    return preciseEnough(entry, matrix) ? path : null;
  }

  private trim(): void {
    // Keep one oversized fill alongside the ordinary budget. Otherwise a tiny
    // decoration painted later would evict it and rebuild it on every pan.
    const oversized = [...this.recent].filter((entry) => entry.points > this.maxPoints);
    const retainedLarge = oversized.pop();
    for (const entry of oversized) this.drop(entry);
    const allowedPoints = this.maxPoints + (retainedLarge?.points ?? 0);
    while (
      this.recent.size > 1 &&
      (this.recent.size > this.maxEntries || this.retainedPoints > allowedPoints)
    ) {
      const oldest = [...this.recent].find((entry) => entry !== retainedLarge);
      if (oldest === undefined) break;
      this.drop(oldest);
    }
  }

  private drop(entry: Entry): void {
    if (this.recent.delete(entry)) this.retainedPoints -= entry.points;
    entry.path = null;
  }
}

function compilePath(polylines: ReadonlyArray<Polyline>, PathCtor: typeof Path2D): Entry {
  const path = new PathCtor();
  let points = 0,
    maxX = 0,
    maxY = 0,
    errorX = 0,
    errorY = 0;
  for (const polyline of polylines) {
    if (!polyline.closed) continue;
    for (let index = 0; index < polyline.points.length; index++) {
      const point = polyline.points[index];
      if (point === undefined) continue;
      if (index === 0) path.moveTo(point.x, point.y);
      else path.lineTo(point.x, point.y);
      maxX = Math.max(maxX, Math.abs(point.x));
      maxY = Math.max(maxY, Math.abs(point.y));
      errorX = Math.max(errorX, Math.abs(Math.fround(point.x) - point.x));
      errorY = Math.max(errorY, Math.abs(Math.fround(point.y) - point.y));
      points++;
    }
  }
  // fill() closes each subpath; closePath per contour reintroduces native batch work.
  return { pathConstructor: PathCtor, points, maxX, maxY, errorX, errorY, path };
}

function preciseEnough(entry: Entry, matrix?: Matrix): boolean {
  if (matrix === undefined) return true;
  if (!matrix.every((value) => Number.isFinite(Math.fround(value)))) return false;
  const [a, b, c, d, e, f] = matrix;
  // Native paths may store float coordinates before applying the view matrix.
  // Allow several float operations in a conservative screen-error estimate.
  // Actual coordinate error also catches overflow/underflow before scaling.
  // This guards geometry precision, not byte-identical edge antialiasing.
  const x = entry.maxX * Math.abs(a) + entry.maxY * Math.abs(c) + Math.abs(e);
  const y = entry.maxX * Math.abs(b) + entry.maxY * Math.abs(d) + Math.abs(f);
  const actualX = entry.errorX * Math.abs(a) + entry.errorY * Math.abs(c);
  const actualY = entry.errorX * Math.abs(b) + entry.errorY * Math.abs(d);
  return Math.max(Math.max(x, y) * 2 ** -21, actualX, actualY) <= 0.005;
}

const filledPaths = new FilledPathCache();
type FillContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function drawCachedClosedFill(
  ctx: FillContext,
  polylines: ReadonlyArray<Polyline>,
  transform: Transform,
  view: ViewTransform,
  fillRule: CanvasFillRule,
): boolean {
  if (typeof Path2D !== 'function') return false;
  const radians = (transform.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians),
    sin = Math.sin(radians);
  const sx = transform.scaleX * (transform.mirrorX ? -1 : 1) * view.scale;
  const sy = transform.scaleY * (transform.mirrorY ? -1 : 1) * view.scale;
  const matrix: Matrix = [
    cos * sx,
    sin * sx,
    -sin * sy,
    cos * sy,
    view.offsetX + transform.x * view.scale,
    view.offsetY + transform.y * view.scale,
  ];
  let path: Path2D | null;
  try {
    path = filledPaths.get(polylines, Path2D, screenMatrix(ctx, matrix));
  } catch {
    return false;
  }
  if (path === null) return false;
  ctx.save();
  try {
    ctx.transform(...matrix);
    ctx.fill(path, fillRule);
  } finally {
    ctx.restore();
  }
  return true;
}

function screenMatrix(ctx: FillContext, matrix: Matrix): Matrix {
  const parent = typeof ctx.getTransform === 'function' ? ctx.getTransform() : undefined;
  if (parent === undefined) return matrix;
  const [a, b, c, d, e, f] = matrix;
  return [
    parent.a * a + parent.c * b,
    parent.b * a + parent.d * b,
    parent.a * c + parent.c * d,
    parent.b * c + parent.d * d,
    parent.a * e + parent.c * f + parent.e,
    parent.b * e + parent.d * f + parent.f,
  ];
}
