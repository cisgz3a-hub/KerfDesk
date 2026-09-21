/* eslint-disable no-restricted-syntax -- Canvas pixels depict scene data on a paper background; these are not UI chrome colours. */
import { useEffect, useRef } from 'react';
import { toSceneCoords, type DeviceProfile } from '../../../core/devices';
import type { LaserSecondPassSelection } from '../../../core/laser-second-pass';
import type { SecondPassDrawing } from './second-pass-preview';
import type { CanvasSize, CanvasView, SecondPassViewport } from './second-pass-canvas-view';
import { drawSecondPassSegments } from './second-pass-render-paths';

type Stroke = LaserSecondPassSelection['strokes'][number];
function canvasContext(
  canvas: HTMLCanvasElement | null,
  size: CanvasSize,
): CanvasRenderingContext2D | null {
  if (!canvas) return null;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(size.width * ratio));
  canvas.height = Math.max(1, Math.round(size.height * ratio));
  const ctx = canvas.getContext('2d');
  ctx?.scale(
    size.width > 0 ? canvas.width / size.width : 1,
    size.height > 0 ? canvas.height / size.height : 1,
  );
  return ctx;
}
function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  device: DeviceProfile,
  view: CanvasView,
): void {
  ctx.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = stroke.powerScale > 1 ? '#e78630' : '#12adbb';
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = stroke.radiusMm * 2 * view.scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const first = stroke.points[0];
  if (!first) return;
  if (stroke.points.every((point) => point.x === first.x && point.y === first.y)) {
    const p = toSceneCoords(first, device);
    ctx.arc(
      p.x * view.scale + view.x,
      p.y * view.scale + view.y,
      stroke.radiusMm * view.scale,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    return;
  }
  stroke.points.forEach((point, i) => {
    const p = toSceneCoords(point, device);
    const x = p.x * view.scale + view.x;
    const y = p.y * view.scale + view.y;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}
export function useSecondPassDrawing(
  props: {
    drawing: SecondPassDrawing;
    preview: SecondPassDrawing | null;
    showPreview: boolean;
    strokes: ReadonlyArray<Stroke>;
    device: DeviceProfile;
  },
  viewport: SecondPassViewport,
  draft: Stroke | null,
) {
  const background = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const { size, view } = viewport;
  useEffect(() => {
    const ctx = canvasContext(background.current, size);
    if (!ctx) return;
    ctx.fillStyle = '#faf7ef';
    ctx.fillRect(0, 0, size.width, size.height);
    drawSecondPassSegments(ctx, props.drawing, view, size, props.showPreview ? 0.16 : 1);
    if (props.showPreview && props.preview)
      drawSecondPassSegments(ctx, props.preview, view, size, 1, '#b64214');
  }, [props.drawing, props.preview, props.showPreview, view, size]);
  useEffect(() => {
    const ctx = canvasContext(overlay.current, size);
    if (!ctx || props.showPreview) return;
    for (const stroke of draft ? [...props.strokes, draft] : props.strokes)
      drawStroke(ctx, stroke, props.device, view);
    ctx.globalCompositeOperation = 'source-over';
  }, [draft, props.strokes, props.device, props.showPreview, size, view]);
  return { background, overlay };
}
