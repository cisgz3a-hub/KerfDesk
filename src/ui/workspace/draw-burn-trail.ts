import type { Vec2 } from '../../core/scene';
import { lerp } from '../../core/job/toolpath-math';
import { burnEmberRamp } from '../theme/canvas-theme';
import type { CanvasMotionPlan, LiveCanvasRun } from '../state/canvas-motion-plan';
import { routeMotionAt, visitRouteRange, type RouteSegment } from './route-range-walk';
import type { ViewTransform } from './view-transform';

/** Route length behind the head that still reads as hot. */
const TAIL_WINDOW_MM = 18;
/** Nominal mark width when the profile carries no measured optics. */
const NOMINAL_LASER_KERF_MM = 0.2;
const NOMINAL_CNC_KERF_MM = 1;
const MIN_BURN_PX = 1.1;
const MAX_BURN_PX = 3;
const HOT_WIDTH_FACTOR = 1.7;
const GLOW_RADIUS_PX = 13;

/** The position marker is always visible; its hot indication needs active work. */
export function burnIsActive(run: LiveCanvasRun): boolean {
  if (
    run.lifecycle !== 'running' ||
    run.plan.capability !== 'realtime' ||
    run.route.uncertain ||
    run.route.confirmedRouteMm <= 0 ||
    run.reportedSpindleRpm === 0 ||
    (run.controllerState !== null && run.controllerState !== 'Run')
  )
    return false;
  // Reconciliation can retain several possible locations at a crossing.
  // Never paint a powered head when one of those locations is laser-off travel.
  if (
    run.route.candidates.some(
      (candidate) => run.plan.manifest.blocks[candidate.blockIndex]?.kind !== 'process',
    )
  )
    return false;
  return routeMotionAt(run.plan, run.route.confirmedRouteMm)?.intent === 'process';
}

/**
 * Device-pixel width of a burned mark.
 *
 * Scaled from the real kerf so zooming in widens the trail to the width the
 * machine actually removes, then clamped: below the floor the trail vanishes,
 * and above the ceiling a dense fill blots out the artwork — which is the
 * failure the fixed 2.4px width produced at every zoom.
 */
export function burnWidthPx(plan: CanvasMotionPlan, view: ViewTransform): number {
  const spot = plan.device.laserSubProfile?.spotSizeMm;
  const kerfMm =
    plan.machineKind === 'cnc'
      ? NOMINAL_CNC_KERF_MM
      : spot === undefined
        ? NOMINAL_LASER_KERF_MM
        : Math.max(spot.x, spot.y);
  return Math.min(MAX_BURN_PX, Math.max(MIN_BURN_PX, kerfMm * view.scale));
}

/**
 * Paints the short glowing tail behind the head, live on the visible context.
 *
 * The settled scorch lives in an append-only raster that is never restroked, so
 * the cooling gradient cannot live there. Drawing it here each frame costs one
 * bounded walk of the last {@link TAIL_WINDOW_MM} and gives the overlay the one
 * thing a static trail cannot: on a CNC depth pass that retraces the same XY
 * route, the trail stops changing entirely and only this tail still moves.
 *
 * Only `process` motion glows — during a rapid the beam is off and nothing is
 * hot, so the tail correctly breaks at every travel.
 */
export function drawBurnTail(
  ctx: CanvasRenderingContext2D,
  plan: CanvasMotionPlan,
  run: LiveCanvasRun,
  view: ViewTransform,
): void {
  if (!burnIsActive(run)) return;
  const ramp = burnEmberRamp();
  const head = Math.max(0, run.route.confirmedRouteMm);
  const bands = collectTailBands(plan, head, ramp.length);
  if (bands.every((band) => band.length === 0)) return;
  const baseWidth = burnWidthPx(plan, view);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  bands.forEach((segments, index) => {
    if (segments.length === 0) return;
    const heat = ramp.length === 1 ? 1 : index / (ramp.length - 1);
    ctx.globalAlpha = 0.3 + heat * 0.7;
    ctx.strokeStyle = ramp[index] ?? ramp[ramp.length - 1] ?? '';
    ctx.lineWidth = baseWidth * (1 + heat * (HOT_WIDTH_FACTOR - 1));
    strokeSegments(ctx, segments, view);
  });
  ctx.restore();
}

/** Radial beam glow under the head marker, hottest at the centre. */
export function drawBurnGlow(
  ctx: CanvasRenderingContext2D,
  at: Vec2,
  run: LiveCanvasRun,
  radiusPx = GLOW_RADIUS_PX,
): void {
  if (!burnIsActive(run) || typeof ctx.createRadialGradient !== 'function') return;
  const ramp = burnEmberRamp();
  const core = ramp[ramp.length - 1];
  const mid = ramp[Math.max(0, ramp.length - 2)];
  if (core === undefined || mid === undefined) return;
  // A live job must never lose its overlay to a decorative gradient, so the
  // glow is skipped wherever the context cannot actually build one.
  const gradient = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, radiusPx);
  if (typeof gradient?.addColorStop !== 'function') return;
  gradient.addColorStop(0, core);
  gradient.addColorStop(0.35, mid);
  gradient.addColorStop(1, 'transparent');
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radiusPx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Buckets the tail window into `bandCount` age bands, coldest first, in a
 * single walk — one pass rather than one walk per band.
 */
function collectTailBands(
  plan: CanvasMotionPlan,
  headRouteMm: number,
  bandCount: number,
): ReadonlyArray<ReadonlyArray<RouteSegment>> {
  const bands: RouteSegment[][] = Array.from({ length: bandCount }, () => []);
  const start = Math.max(0, headRouteMm - TAIL_WINDOW_MM);
  const span = headRouteMm - start;
  if (span <= 0) return bands;
  visitRouteRange(plan, start, headRouteMm, (segment) => {
    if (segment.intent !== 'process') return;
    appendTailSegment(bands, segment, start, span);
  });
  return bands;
}

// Split at heat boundaries so the same physical line has the same ramp whether
// the emitter represents it as one long G1 or many short G1 moves. Route extents
// include Z, while the interpolation uses the already-mapped scene endpoints.
function appendTailSegment(
  bands: RouteSegment[][],
  segment: RouteSegment,
  start: number,
  span: number,
): void {
  const length = segment.endRouteMm - segment.startRouteMm;
  for (const [index, band] of bands.entries()) {
    const from = Math.max(segment.startRouteMm, start + (span * index) / bands.length);
    const to = Math.min(segment.endRouteMm, start + (span * (index + 1)) / bands.length);
    if (to <= from) continue;
    band.push({
      ...segment,
      from: lerp(segment.from, segment.to, (from - segment.startRouteMm) / length),
      to: lerp(segment.from, segment.to, (to - segment.startRouteMm) / length),
      startRouteMm: from,
      endRouteMm: to,
    });
  }
}

function strokeSegments(
  ctx: CanvasRenderingContext2D,
  segments: ReadonlyArray<RouteSegment>,
  view: ViewTransform,
): void {
  ctx.beginPath();
  for (const segment of segments) {
    ctx.moveTo(
      view.offsetX + segment.from.x * view.scale,
      view.offsetY + segment.from.y * view.scale,
    );
    ctx.lineTo(view.offsetX + segment.to.x * view.scale, view.offsetY + segment.to.y * view.scale);
  }
  ctx.stroke();
}
