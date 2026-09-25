// Preview "Start points" (ADR-385): a dot where each closed Line cut starts
// burning and an arrow along the way it runs. The marks come from the prepared
// job the G-code is emitted from and are mapped with the same scene mapper as
// the route, so they sit exactly on the route's contour starts.

import type { DeviceProfile } from '../../core/devices';
import type { Job, Toolpath } from '../../core/job';
import { closedCutStartMarkers, type CutStartMarker } from '../../core/job/cut-start-markers';
import type { Vec2 } from '../../core/scene';
import { canvasTheme } from '../theme/canvas-theme';
import type { PreviewToolpath } from './preview-status';
import { scenePointMapper } from './preview-scene-frame';
import type { ViewTransform } from './view-transform';

const DOT_RADIUS_PX = 3;
const ARROW_LENGTH_PX = 14;
const ARROW_HEAD_PX = 4.5;

/** A copy of `toolpath` carrying the job's closed-cut starts in scene space. */
export function withPreviewCutStartMarkers<T extends PreviewToolpath>(
  toolpath: T,
  job: Job,
  jobOriginOffset: Vec2,
  device: DeviceProfile,
): T {
  const markers = closedCutStartMarkers(job);
  if (markers.length === 0) return toolpath;
  const mapPoint = scenePointMapper(jobOriginOffset, device);
  return { ...toolpath, cutStartMarkers: markers.map((marker) => sceneMarker(marker, mapPoint)) };
}

export function previewCutStartMarkers(toolpath: Toolpath): ReadonlyArray<CutStartMarker> {
  return (toolpath as PreviewToolpath).cutStartMarkers ?? [];
}

export function drawPreviewCutStartMarkers(
  ctx: CanvasRenderingContext2D,
  toolpath: Toolpath,
  view: ViewTransform,
): void {
  const markers = previewCutStartMarkers(toolpath);
  if (markers.length === 0) return;
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  drawMarkerSet(
    ctx,
    markers.filter((marker) => !marker.operatorSet),
    view,
    canvasTheme.previewCutStart,
  );
  drawMarkerSet(
    ctx,
    markers.filter((marker) => marker.operatorSet),
    view,
    canvasTheme.previewCutStartSet,
  );
  ctx.restore();
}

// The mapper is an isometry (placement shift, then origin flip), so mapping a
// point one unit ahead keeps the direction a unit vector in scene space.
function sceneMarker(marker: CutStartMarker, mapPoint: (p: Vec2) => Vec2): CutStartMarker {
  const at = mapPoint(marker.at);
  const ahead = mapPoint({
    x: marker.at.x + marker.direction.x,
    y: marker.at.y + marker.direction.y,
  });
  return {
    at,
    direction: { x: ahead.x - at.x, y: ahead.y - at.y },
    operatorSet: marker.operatorSet,
  };
}

// One path per colour: a dense job draws thousands of marks every frame.
function drawMarkerSet(
  ctx: CanvasRenderingContext2D,
  markers: ReadonlyArray<CutStartMarker>,
  view: ViewTransform,
  color: string,
): void {
  if (markers.length === 0) return;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.beginPath();
  for (const marker of markers) {
    const x = view.offsetX + marker.at.x * view.scale;
    const y = view.offsetY + marker.at.y * view.scale;
    ctx.moveTo(x + DOT_RADIUS_PX, y);
    ctx.arc(x, y, DOT_RADIUS_PX, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.beginPath();
  for (const marker of markers) appendArrow(ctx, marker, view);
  ctx.stroke();
}

function appendArrow(
  ctx: CanvasRenderingContext2D,
  marker: CutStartMarker,
  view: ViewTransform,
): void {
  const x = view.offsetX + marker.at.x * view.scale;
  const y = view.offsetY + marker.at.y * view.scale;
  const { x: dx, y: dy } = marker.direction;
  const tipX = x + dx * ARROW_LENGTH_PX;
  const tipY = y + dy * ARROW_LENGTH_PX;
  ctx.moveTo(x, y);
  ctx.lineTo(tipX, tipY);
  // Barbs swept back from the tip, either side of the shaft.
  ctx.moveTo(tipX - (dx + dy) * ARROW_HEAD_PX, tipY - (dy - dx) * ARROW_HEAD_PX);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(tipX - (dx - dy) * ARROW_HEAD_PX, tipY - (dy + dx) * ARROW_HEAD_PX);
}
