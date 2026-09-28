/* eslint-disable no-restricted-syntax -- Canvas pixels depict scene data on a paper background; these are not UI chrome colours. */
import { useEffect, useRef } from 'react';
import { toSceneCoords, type DeviceProfile } from '../../../core/devices';
import type { LaserSecondPassSelection } from '../../../core/laser-second-pass';
import type { SecondPassDrawing } from './second-pass-preview';
import type { CanvasView, SecondPassViewport } from './second-pass-canvas-view';
import {
  SECOND_PASS_REDRAW_DELAY_MS,
  SecondPassBackgroundCache,
  secondPassCanvasContext,
} from './second-pass-background-cache';

type Stroke = LaserSecondPassSelection['strokes'][number];
function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  device: DeviceProfile,
  view: CanvasView,
  color = stroke.powerScale > 1 ? '#e78630' : '#12adbb',
): void {
  ctx.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = color;
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
    selected: string | null;
  },
  viewport: Pick<SecondPassViewport, 'size' | 'view'>,
  draft: Stroke | null,
) {
  const background = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const highlight = useRef<HTMLCanvasElement>(null);
  const cache = useRef(new SecondPassBackgroundCache());
  const { size, view } = viewport;
  useEffect(() => {
    const canvas = background.current;
    if (!canvas) return;
    const scene = {
      drawing: props.drawing,
      preview: props.preview,
      showPreview: props.showPreview,
    };
    if (cache.current.draw(canvas, scene, view, size) !== 'cached') return;
    const timer = window.setTimeout(() => {
      cache.current.draw(canvas, scene, view, size, true);
    }, SECOND_PASS_REDRAW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [props.drawing, props.preview, props.showPreview, view, size]);
  useEffect(() => {
    const ctx = overlay.current && secondPassCanvasContext(overlay.current, size);
    if (!ctx || props.showPreview) return;
    for (const stroke of draft ? [...props.strokes, draft] : props.strokes)
      drawStroke(ctx, stroke, props.device, view);
    ctx.globalCompositeOperation = 'source-over';
  }, [draft, props.strokes, props.device, props.showPreview, size, view]);
  useEffect(() => {
    const ctx = highlight.current && secondPassCanvasContext(highlight.current, size);
    if (!ctx || props.showPreview) return;
    const selected = props.strokes.find((stroke) => stroke.id === props.selected);
    if (!selected) return;
    // Outline the whole selected footprint on its own layer. Erasing its centre
    // cannot erase the painted mask or change the selected machining region.
    drawStroke(
      ctx,
      { ...selected, mode: 'paint', radiusMm: selected.radiusMm + 2 / view.scale },
      props.device,
      view,
      '#073b4c',
    );
    drawStroke(ctx, { ...selected, mode: 'erase' }, props.device, view);
    ctx.globalCompositeOperation = 'source-over';
  }, [props.selected, props.strokes, props.device, props.showPreview, size, view]);
  return { background, overlay, highlight };
}
