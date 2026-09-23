import type { CanvasMotionPlan } from '../state/canvas-motion-plan';
import { canvasPreviewMotionSequence } from '../state/canvas-preview-motion';
import { scenePointMapper, walkRouteLines, type MutableScenePoint } from './route-range-walk';

/** Scene-space (millimetre) rectangle. */
export type SceneBounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export type RouteChunk = {
  readonly path: Path2D;
  readonly bounds: SceneBounds;
};

/** The whole planned route in scene space, built once per plan. */
export type PlannedRoute = {
  readonly pathConstructor: typeof Path2D;
  /**
   * Every planned rapid in ONE path: they are stroked translucent, and two
   * separate strokes would double the alpha wherever rapids cross.
   */
  readonly travel: Path2D;
  /**
   * Planned cuts in bounded chunks. They are stroked opaque into the raster,
   * so chunking is invisible, while it lets a rebuild skip off-screen chunks
   * and yield between them.
   */
  readonly process: ReadonlyArray<RouteChunk>;
  /** Drawable XY segments in the plan, for the hairline policy. */
  readonly segmentCount: number;
};

/** Newly confirmed route between two positions, ready to stroke. */
export type RouteBatch = {
  readonly process: Path2D;
  readonly travel: Path2D;
  /** Route position the batch reached; the next batch starts exactly here. */
  readonly endRouteMm: number;
};

// Small enough that one wide-stroked chunk stays inside a rebuild slice.
const ROUTE_CHUNK_SEGMENTS = 2_048;
const plannedRouteCache = new WeakMap<CanvasMotionPlan, PlannedRoute>();

export function plannedRoute(plan: CanvasMotionPlan, PathCtor: typeof Path2D): PlannedRoute {
  const cached = plannedRouteCache.get(plan);
  if (cached !== undefined && cached.pathConstructor === PathCtor) return cached;
  const map = scenePointMapper(plan);
  const from: MutableScenePoint = { x: 0, y: 0 };
  const to: MutableScenePoint = { x: 0, y: 0 };
  const travel = new ChainedPath(new PathCtor());
  const process = new RouteChunkBuilder(PathCtor);
  let segmentCount = 0;
  for (const motion of canvasPreviewMotionSequence(plan).motions) {
    if (motion.intent === 'plunge' || motion.intent === 'retract') continue;
    const points = motion.pointsMm;
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      if (start === undefined || end === undefined) continue;
      map(start.x, start.y, from);
      map(end.x, end.y, to);
      if (motion.intent === 'process') process.line(from.x, from.y, to.x, to.y);
      else travel.line(from.x, from.y, to.x, to.y);
      segmentCount += 1;
    }
  }
  const built = {
    pathConstructor: PathCtor,
    travel: travel.path,
    process: process.finish(),
    segmentCount,
  };
  plannedRouteCache.set(plan, built);
  return built;
}

/**
 * Collects the confirmed route in `[fromRouteMm, toRouteMm)`.
 *
 * Segments wholly outside `cull` are skipped: the raster is the size of the
 * visible canvas, so they could not have left a pixel. `maxSegments` bounds the
 * walk (culled segments count, since walking them is the cost) so a rebuild can
 * yield between batches. Consecutive cuts are chained into one polyline, which
 * the stroker handles as joins rather than two caps per segment; rapids stay
 * separate subpaths so their dash pattern restarts per segment as before.
 */
export function confirmedRouteBatch(
  plan: CanvasMotionPlan,
  PathCtor: typeof Path2D,
  fromRouteMm: number,
  toRouteMm: number,
  cull: SceneBounds | null,
  maxSegments = Number.POSITIVE_INFINITY,
): RouteBatch {
  const process = new ChainedPath(new PathCtor());
  const travel = new PathCtor();
  let walked = 0;
  const endRouteMm = walkRouteLines(plan, fromRouteMm, toRouteMm, (x0, y0, x1, y1, intent) => {
    walked += 1;
    if (cull !== null && !segmentTouches(cull, x0, y0, x1, y1)) {
      if (intent === 'process') process.lift();
    } else if (intent === 'process') {
      process.line(x0, y0, x1, y1);
    } else {
      travel.moveTo(x0, y0);
      travel.lineTo(x1, y1);
    }
    return walked < maxSegments;
  });
  return { process: process.path, travel, endRouteMm };
}

export function boundsTouch(a: SceneBounds, b: SceneBounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function segmentTouches(
  bounds: SceneBounds,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  return (
    Math.min(x0, x1) <= bounds.maxX &&
    Math.max(x0, x1) >= bounds.minX &&
    Math.min(y0, y1) <= bounds.maxY &&
    Math.max(y0, y1) >= bounds.minY
  );
}

/** A path that continues a polyline when the next segment starts at the pen. */
class ChainedPath {
  private penX = Number.NaN;
  private penY = Number.NaN;

  constructor(readonly path: Path2D) {}

  line(x0: number, y0: number, x1: number, y1: number): void {
    if (x0 !== this.penX || y0 !== this.penY) this.path.moveTo(x0, y0);
    this.path.lineTo(x1, y1);
    this.penX = x1;
    this.penY = y1;
  }

  lift(): void {
    this.penX = Number.NaN;
    this.penY = Number.NaN;
  }
}

class RouteChunkBuilder {
  private readonly chunks: RouteChunk[] = [];
  private current: ChainedPath | null = null;
  private segments = 0;
  private minX = Number.POSITIVE_INFINITY;
  private minY = Number.POSITIVE_INFINITY;
  private maxX = Number.NEGATIVE_INFINITY;
  private maxY = Number.NEGATIVE_INFINITY;

  constructor(private readonly PathCtor: typeof Path2D) {}

  line(x0: number, y0: number, x1: number, y1: number): void {
    if (this.current === null || this.segments >= ROUTE_CHUNK_SEGMENTS) this.open();
    this.current?.line(x0, y0, x1, y1);
    this.segments += 1;
    // The start is the previous end on a chained run, so only the end extends.
    this.include(x0, y0);
    this.include(x1, y1);
  }

  private include(x: number, y: number): void {
    if (x < this.minX) this.minX = x;
    if (x > this.maxX) this.maxX = x;
    if (y < this.minY) this.minY = y;
    if (y > this.maxY) this.maxY = y;
  }

  finish(): ReadonlyArray<RouteChunk> {
    this.close();
    return this.chunks;
  }

  private open(): void {
    this.close();
    this.current = new ChainedPath(new this.PathCtor());
  }

  private close(): void {
    if (this.current === null || this.segments === 0) return;
    this.chunks.push({
      path: this.current.path,
      bounds: { minX: this.minX, minY: this.minY, maxX: this.maxX, maxY: this.maxY },
    });
    this.current = null;
    this.segments = 0;
    this.minX = Number.POSITIVE_INFINITY;
    this.minY = Number.POSITIVE_INFINITY;
    this.maxX = Number.NEGATIVE_INFINITY;
    this.maxY = Number.NEGATIVE_INFINITY;
  }
}
