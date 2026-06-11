// F-A2 rulers — top and left strips, mm ticks every 10mm, labels every
// 50mm. Coordinates are in scene-mm via the view transform so they
// respect zoom + pan. Drawn over the canvas content (origin marker stays
// visible at the top-left corner where the rulers meet).

import { canvasTheme } from '../theme/canvas-theme';
import type { ViewTransform } from './view-transform';

const RULER_THICKNESS_PX = 18;
const RULER_TICK_MM = 10;
const RULER_LABEL_EVERY_MM = 50;

export function drawRulers(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  view: ViewTransform,
): void {
  ctx.save();
  ctx.fillStyle = canvasTheme.rulerBackground;
  ctx.fillRect(0, 0, canvasW, RULER_THICKNESS_PX);
  ctx.fillRect(0, 0, RULER_THICKNESS_PX, canvasH);
  ctx.strokeStyle = canvasTheme.rulerBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, RULER_THICKNESS_PX + 0.5);
  ctx.lineTo(canvasW, RULER_THICKNESS_PX + 0.5);
  ctx.moveTo(RULER_THICKNESS_PX + 0.5, 0);
  ctx.lineTo(RULER_THICKNESS_PX + 0.5, canvasH);
  ctx.stroke();
  ctx.fillStyle = canvasTheme.rulerText;
  ctx.font = '10px ui-monospace, Menlo, monospace';
  ctx.textBaseline = 'top';
  drawHorizontalRuler(ctx, canvasW, view);
  drawVerticalRuler(ctx, canvasH, view);
  ctx.restore();
}

function drawHorizontalRuler(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  view: ViewTransform,
): void {
  const startMm = Math.floor(-view.offsetX / view.scale / RULER_TICK_MM) * RULER_TICK_MM;
  const endMm = Math.ceil((canvasW - view.offsetX) / view.scale / RULER_TICK_MM) * RULER_TICK_MM;
  for (let mm = startMm; mm <= endMm; mm += RULER_TICK_MM) {
    const px = view.offsetX + mm * view.scale;
    if (px < RULER_THICKNESS_PX || px > canvasW) continue;
    const major = mm % RULER_LABEL_EVERY_MM === 0;
    ctx.strokeStyle = major ? canvasTheme.rulerMajorTick : canvasTheme.rulerMinorTick;
    ctx.beginPath();
    ctx.moveTo(px + 0.5, RULER_THICKNESS_PX - (major ? 8 : 4));
    ctx.lineTo(px + 0.5, RULER_THICKNESS_PX);
    ctx.stroke();
    if (major) ctx.fillText(String(mm), px + 2, 2);
  }
}

function drawVerticalRuler(
  ctx: CanvasRenderingContext2D,
  canvasH: number,
  view: ViewTransform,
): void {
  const startMm = Math.floor(-view.offsetY / view.scale / RULER_TICK_MM) * RULER_TICK_MM;
  const endMm = Math.ceil((canvasH - view.offsetY) / view.scale / RULER_TICK_MM) * RULER_TICK_MM;
  for (let mm = startMm; mm <= endMm; mm += RULER_TICK_MM) {
    const py = view.offsetY + mm * view.scale;
    if (py < RULER_THICKNESS_PX || py > canvasH) continue;
    const major = mm % RULER_LABEL_EVERY_MM === 0;
    ctx.strokeStyle = major ? canvasTheme.rulerMajorTick : canvasTheme.rulerMinorTick;
    ctx.beginPath();
    ctx.moveTo(RULER_THICKNESS_PX - (major ? 8 : 4), py + 0.5);
    ctx.lineTo(RULER_THICKNESS_PX, py + 0.5);
    ctx.stroke();
    if (major) ctx.fillText(String(mm), 2, py + 2);
  }
}
