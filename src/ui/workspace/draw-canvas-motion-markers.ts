import type { Vec2 } from '../../core/scene';
import type { CanvasMotionPlan } from '../state/canvas-motion-plan';
import { canvasTheme } from '../theme/canvas-theme';
import { RULER_THICKNESS_PX } from './canvas-layout';
import {
  layoutCanvasStartLabels,
  markerLeaderEnd,
  type MarkerBox,
  type PlacedStartMarker,
  type StartMarkerKind,
  type StartMarkerLabel,
} from './canvas-motion-marker-layout';
import type { CanvasBitmapSize } from './use-canvas-bitmap-size';
import type { ViewTransform } from './view-transform';

const LABEL_FONT = '600 12px system-ui, sans-serif';
const LABEL_HEIGHT = 24;
const UPDATING_HEIGHT = 38;
const EDGE_GAP = 6;

export function drawCanvasStartMarkers(
  ctx: CanvasRenderingContext2D,
  plan: CanvasMotionPlan,
  view: ViewTransform,
  updating: boolean,
  viewport?: CanvasBitmapSize,
  artwork: ReadonlyArray<MarkerBox> = [],
): void {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.setLineDash([]);
  const markers = startLabels(ctx, plan, view, updating);
  const bounds = labelBounds(plan, view, markers, viewport);
  const placed = layoutCanvasStartLabels(markers, bounds, artwork);
  for (const marker of placed) drawLeader(ctx, marker);
  drawFrameDirection(ctx, plan, view);
  for (const marker of placed) drawMarkerLabel(ctx, marker, updating);
  // A hollow diamond surrounds a smaller filled triangle when starts coincide.
  // Neither symbol is moved to imply a different planned start position.
  for (const marker of placed) drawStartGlyph(ctx, marker.anchor, marker.kind, true);
  ctx.restore();
}

function startLabels(
  ctx: CanvasRenderingContext2D,
  plan: CanvasMotionPlan,
  view: ViewTransform,
  updating: boolean,
): StartMarkerLabel[] {
  const markers: StartMarkerLabel[] = [];
  const add = (point: Vec2, kind: StartMarkerKind, label: string): void => {
    markers.push({
      kind,
      label,
      anchor: sceneToCanvas(point, view),
      width:
        Math.max(ctx.measureText(label).width, updating ? ctx.measureText('Updating…').width : 0) +
        36,
      height: updating ? UPDATING_HEIGHT : LABEL_HEIGHT,
    });
  };
  const frameStart = plan.framePerimeter[0];
  if (frameStart !== undefined) add(frameStart, 'frame', 'Frame start');
  if (plan.jobStart !== null) add(plan.jobStart, 'job', 'Job start');
  return markers;
}

function labelBounds(
  plan: CanvasMotionPlan,
  view: ViewTransform,
  markers: ReadonlyArray<StartMarkerLabel>,
  viewport: CanvasBitmapSize | undefined,
): MarkerBox {
  const bed = {
    x: view.offsetX + EDGE_GAP,
    y: view.offsetY + EDGE_GAP,
    width: Math.max(0, plan.device.bedWidth * view.scale - EDGE_GAP * 2),
    height: Math.max(0, plan.device.bedHeight * view.scale - EDGE_GAP * 2),
  };
  if (viewport === undefined) return bed;
  const inset = RULER_THICKNESS_PX + EDGE_GAP;
  const canvas = {
    x: inset,
    y: inset,
    width: Math.max(0, viewport.width - inset - EDGE_GAP),
    height: Math.max(0, viewport.height - inset - EDGE_GAP),
  };
  const x = Math.max(bed.x, canvas.x);
  const y = Math.max(bed.y, canvas.y);
  const visibleBed = {
    x,
    y,
    width: Math.max(0, Math.min(bed.x + bed.width, canvas.x + canvas.width) - x),
    height: Math.max(0, Math.min(bed.y + bed.height, canvas.y + canvas.height) - y),
  };
  const neededWidth = Math.max(0, ...markers.map((marker) => marker.width));
  const neededHeight = markers.reduce((height, marker) => height + marker.height + EDGE_GAP, 0);
  // At extreme zoom-out or pan the bed may no longer fit two readable names.
  // Keep the plates in the viewport, with leaders to the unchanged anchors.
  return visibleBed.width >= neededWidth && visibleBed.height >= neededHeight ? visibleBed : canvas;
}

function drawLeader(ctx: CanvasRenderingContext2D, marker: PlacedStartMarker): void {
  const end = markerLeaderEnd(marker.anchor, marker.box);
  ctx.beginPath();
  ctx.moveTo(marker.anchor.x, marker.anchor.y);
  ctx.lineTo(end.x, end.y);
  ctx.strokeStyle = canvasTheme.motionLabelPlate;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = markerAccent(marker.kind);
  ctx.lineWidth = 1.25;
  ctx.stroke();
}

function drawMarkerLabel(
  ctx: CanvasRenderingContext2D,
  marker: PlacedStartMarker,
  updating: boolean,
): void {
  const { x, y, width, height } = marker.box;
  ctx.fillStyle = canvasTheme.motionLabelPlate;
  ctx.strokeStyle = markerAccent(marker.kind);
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, width, height, 5);
  else ctx.rect(x, y, width, height);
  ctx.fill();
  ctx.stroke();
  drawStartGlyph(ctx, { x: x + 13, y: y + 12 }, marker.kind, false);
  ctx.font = LABEL_FONT;
  ctx.fillStyle = canvasTheme.artworkInk;
  ctx.fillText(marker.label, x + 26, y + 16);
  if (!updating) return;
  ctx.font = '500 11px system-ui, sans-serif';
  ctx.fillText('Updating…', x + 26, y + 31);
}

function drawStartGlyph(
  ctx: CanvasRenderingContext2D,
  at: Vec2,
  kind: StartMarkerKind,
  anchor: boolean,
): void {
  ctx.beginPath();
  if (kind === 'frame') {
    const size = anchor ? 8 : 5;
    ctx.moveTo(at.x, at.y - size);
    ctx.lineTo(at.x + size, at.y);
    ctx.lineTo(at.x, at.y + size);
    ctx.lineTo(at.x - size, at.y);
  } else {
    ctx.moveTo(at.x - 3, at.y - 4);
    ctx.lineTo(at.x + 4, at.y);
    ctx.lineTo(at.x - 3, at.y + 4);
  }
  ctx.closePath();
  ctx.strokeStyle = canvasTheme.motionLabelPlate;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = markerAccent(kind);
  ctx.fillStyle = markerAccent(kind);
  ctx.lineWidth = 2;
  if (kind === 'job') ctx.fill();
  ctx.stroke();
}

function drawFrameDirection(
  ctx: CanvasRenderingContext2D,
  plan: CanvasMotionPlan,
  view: ViewTransform,
): void {
  const start = plan.framePerimeter[0];
  const next = plan.framePerimeter[1];
  if (start === undefined || next === undefined) return;
  const from = sceneToCanvas(start, view);
  const toward = sceneToCanvas(next, view);
  const angle = Math.atan2(toward.y - from.y, toward.x - from.x);
  const end = { x: from.x + Math.cos(angle) * 20, y: from.y + Math.sin(angle) * 20 };
  ctx.strokeStyle = canvasTheme.frameStart;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(end.x, end.y);
  ctx.lineTo(end.x - Math.cos(angle - Math.PI / 6) * 6, end.y - Math.sin(angle - Math.PI / 6) * 6);
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(end.x - Math.cos(angle + Math.PI / 6) * 6, end.y - Math.sin(angle + Math.PI / 6) * 6);
  ctx.stroke();
}

function markerAccent(kind: StartMarkerKind): string {
  return kind === 'frame' ? canvasTheme.frameStart : canvasTheme.jobStart;
}

function sceneToCanvas(point: Vec2, view: ViewTransform): Vec2 {
  return { x: view.offsetX + point.x * view.scale, y: view.offsetY + point.y * view.scale };
}
