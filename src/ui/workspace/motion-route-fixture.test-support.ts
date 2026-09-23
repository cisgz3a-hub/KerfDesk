// Synthetic raster-fill plans and frame helpers for the burn-route tests.

import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import { fingerprintGcode } from '../../core/recovery';
import {
  mapControllerPointToScene,
  startLiveCanvasRun,
  type CanvasMotionPlan,
  type LiveCanvasRun,
} from '../state/canvas-motion-plan';
import { canvasPreviewMotionSequence } from '../state/canvas-preview-motion';
import { burnWidthPx } from './draw-burn-trail';
import { drawCanvasMotionRoute } from './draw-canvas-motion-route';
import { inkCanvas, inkContextOf, InkPath2D } from './motion-route-ink.test-support';
import type { RoutePalette } from './motion-route-style';
import { visitRouteRange } from './route-range-walk';
import type { ViewTransform } from './view-transform';

/** One ink channel per role: R scorch, G confirmed travel, B planned. */
// eslint-disable-next-line no-restricted-syntax -- test palette, not chrome: pure primaries keep each route role in its own ink channel.
export const PALETTE: RoutePalette = { planned: '#0000ff', scorch: '#ff0000', travel: '#00ff00' };

export type HatchOptions = {
  readonly rows: number;
  readonly segmentsPerRow: number;
  readonly pitchMm?: number;
  readonly lengthMm?: number;
};

/**
 * A serpentine raster fill: `rows` sweeps of `segmentsPerRow` G1 moves each
 * (alternating power, as a grayscale fill emits), joined by a G0 hop.
 */
export function hatchPlan(options: HatchOptions): CanvasMotionPlan {
  const pitch = options.pitchMm ?? 0.1;
  const length = options.lengthMm ?? 20;
  const lines = ['G21', 'G90', 'M3 S0', 'G0 X0 Y0'];
  for (let row = 0; row < options.rows; row += 1) {
    if (row > 0) lines.push(`G0 Y${(row * pitch).toFixed(4)}`);
    for (let step = 1; step <= options.segmentsPerRow; step += 1) {
      const along = (step * length) / options.segmentsPerRow;
      const x = row % 2 === 0 ? along : length - along;
      lines.push(`G1 X${x.toFixed(4)} S${step % 2 === 0 ? 500 : 400}`);
    }
  }
  const gcode = lines.join('\n');
  return {
    manifest: buildMotionManifest(gcode, { machineKind: 'laser' }),
    fingerprint: fingerprintGcode(gcode),
    retentionKey: `hatch-${options.rows}-${options.segmentsPerRow}`,
    machineKind: 'laser',
    device: { ...DEFAULT_DEVICE_PROFILE, origin: 'rear-left' },
    coordinateFrame: { kind: 'machine', workOffsetMm: { x: 0, y: 0, z: 0 } },
    framePerimeter: [],
    jobStart: null,
    approachFrom: null,
    capability: 'realtime',
    unavailableReason: null,
    resumed: false,
    positionEpoch: 0,
  };
}

/** A structurally identical plan with its own identity (and so its own caches). */
export function twin(plan: CanvasMotionPlan): CanvasMotionPlan {
  return { ...plan };
}

export function liveRun(plan: CanvasMotionPlan, confirmedRouteMm: number): LiveCanvasRun {
  return {
    ...startLiveCanvasRun(plan),
    route: { confirmedRouteMm, candidates: [], uncertain: false },
  };
}

/** Clears the visible canvas, draws the route, and returns a copy of its pixels. */
export function paintFrame(
  visible: HTMLCanvasElement,
  plan: CanvasMotionPlan,
  confirmedRouteMm: number,
  view: ViewTransform,
  requestRedraw?: () => void,
): Float32Array {
  const ink = inkContextOf(visible);
  ink.clearRect(0, 0, visible.width, visible.height);
  const ctx = visible.getContext('2d');
  if (ctx === null) throw new Error('ink canvas not installed');
  drawCanvasMotionRoute(ctx, plan, liveRun(plan, confirmedRouteMm), view, PALETTE, requestRedraw);
  return ink.pixels().slice();
}

/**
 * The route raster exactly as it was drawn before the placeholder/hairline
 * change: the planned route as one path per intent at 1.2 px with round caps,
 * each confirmed range appended as two-point subpaths at the kerf-scaled width,
 * the raster composited once at 0.62. `cadence` is the confirmed position at
 * each status update, so appends split exactly where the live run split them.
 */
export function paintReference(
  visible: HTMLCanvasElement,
  plan: CanvasMotionPlan,
  cadence: ReadonlyArray<number>,
  view: ViewTransform,
): Float32Array {
  const raster = inkCanvas(visible.width, visible.height);
  const ink = inkContextOf(raster);
  const planned = { process: new InkPath2D(), travel: new InkPath2D() };
  for (const motion of canvasPreviewMotionSequence(plan).motions) {
    if (motion.intent === 'plunge' || motion.intent === 'retract' || motion.pointsMm.length < 2) {
      continue;
    }
    const path = motion.intent === 'process' ? planned.process : planned.travel;
    motion.pointsMm.forEach((point, index) => {
      const scene = mapControllerPointToScene(point, plan);
      if (index === 0) path.moveTo(scene.x, scene.y);
      else path.lineTo(scene.x, scene.y);
    });
  }
  oldStroke(ink, planned.travel, view, PALETTE.planned, 1.2, 0.3);
  oldStroke(ink, planned.process, view, PALETTE.planned, 1.2, 1);
  let from = 0;
  for (const to of cadence) {
    const confirmed = { process: new InkPath2D(), travel: new InkPath2D() };
    visitRouteRange(plan, from, to, (segment) => {
      const path = segment.intent === 'process' ? confirmed.process : confirmed.travel;
      path.moveTo(segment.from.x, segment.from.y);
      path.lineTo(segment.to.x, segment.to.y);
    });
    oldStroke(ink, confirmed.process, view, PALETTE.scorch, burnWidthPx(plan, view), 1);
    oldStroke(ink, confirmed.travel, view, PALETTE.travel, 1, 0.3);
    from = Math.max(from, to);
  }
  const target = inkContextOf(visible);
  target.clearRect(0, 0, visible.width, visible.height);
  target.save();
  target.globalAlpha = 0.62;
  target.drawImage(raster, 0, 0);
  target.restore();
  return target.pixels().slice();
}

function oldStroke(
  ink: ReturnType<typeof inkContextOf>,
  path: InkPath2D,
  view: ViewTransform,
  color: string,
  widthPx: number,
  alpha: number,
): void {
  ink.save();
  ink.setTransform(view.scale, 0, 0, view.scale, view.offsetX, view.offsetY);
  ink.globalAlpha = alpha;
  ink.strokeStyle = color;
  ink.lineWidth = widthPx / view.scale;
  ink.lineCap = 'round';
  ink.stroke(path);
  ink.restore();
}
