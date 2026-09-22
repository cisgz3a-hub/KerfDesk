// F-A2 rulers — top and left strips. Coordinates are in scene-mm via the view
// transform so they respect zoom + pan. Drawn over the canvas content (origin
// marker stays visible at the top-left corner where the rulers meet).
//
// Tick and label spacing follow the zoom (ADR-348, `ruler-steps.ts`): the
// labelled step is the smallest nice number whose labels stay ~62 px apart,
// and minor ticks subdivide it while they stay ~5 px apart. A half-step tick
// is drawn taller than the rest so the eye can halve a division without
// counting. The live pointer position is NOT drawn here — it would redraw the
// whole scene per mouse-move; `RulerCursorOverlay` tracks it in the DOM.

import { canvasTheme } from '../theme/canvas-theme';
import { RULER_THICKNESS_PX } from './canvas-layout';
import { formatRulerLabel, rulerSteps } from './ruler-steps';
import type { ViewTransform } from './view-transform';

const MAJOR_TICK_PX = 9;
const HALF_TICK_PX = 6;
const MINOR_TICK_PX = 4;
// Ticks are bounded by the adaptive step, but a degenerate scale must never
// spin the loop: this caps one strip at more marks than any strip can show.
const MAX_TICKS = 4000;

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
  ctx.font = '12px ui-monospace, Menlo, monospace';
  ctx.textBaseline = 'top';
  const steps = rulerSteps(view.scale);
  drawHorizontalRuler(ctx, canvasW, view, steps);
  drawVerticalRuler(ctx, canvasH, view, steps);
  ctx.restore();
}

type Steps = ReturnType<typeof rulerSteps>;

function drawHorizontalRuler(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  view: ViewTransform,
  steps: Steps,
): void {
  for (const mm of tickRange(
    steps,
    -view.offsetX / view.scale,
    (canvasW - view.offsetX) / view.scale,
  )) {
    const px = view.offsetX + mm * view.scale;
    if (px < RULER_THICKNESS_PX || px > canvasW) continue;
    const kind = tickKind(mm, steps);
    ctx.strokeStyle = kind === 'minor' ? canvasTheme.rulerMinorTick : canvasTheme.rulerMajorTick;
    ctx.beginPath();
    ctx.moveTo(px + 0.5, RULER_THICKNESS_PX - tickLength(kind));
    ctx.lineTo(px + 0.5, RULER_THICKNESS_PX);
    ctx.stroke();
    if (kind === 'major') ctx.fillText(formatRulerLabel(mm), px + 2, 2);
  }
}

function drawVerticalRuler(
  ctx: CanvasRenderingContext2D,
  canvasH: number,
  view: ViewTransform,
  steps: Steps,
): void {
  for (const mm of tickRange(
    steps,
    -view.offsetY / view.scale,
    (canvasH - view.offsetY) / view.scale,
  )) {
    const py = view.offsetY + mm * view.scale;
    if (py < RULER_THICKNESS_PX || py > canvasH) continue;
    const kind = tickKind(mm, steps);
    ctx.strokeStyle = kind === 'minor' ? canvasTheme.rulerMinorTick : canvasTheme.rulerMajorTick;
    ctx.beginPath();
    ctx.moveTo(RULER_THICKNESS_PX - tickLength(kind), py + 0.5);
    ctx.lineTo(RULER_THICKNESS_PX, py + 0.5);
    ctx.stroke();
    if (kind === 'major') ctx.fillText(formatRulerLabel(mm), 2, py + 2, RULER_THICKNESS_PX - 4);
  }
}

function tickRange(steps: Steps, startMm: number, endMm: number): ReadonlyArray<number> {
  const first = Math.floor(startMm / steps.minorMm) * steps.minorMm;
  const last = Math.ceil(endMm / steps.minorMm) * steps.minorMm;
  const count = Math.min(MAX_TICKS, Math.max(0, Math.round((last - first) / steps.minorMm)));
  // Multiply rather than accumulate: adding 0.1 mm 500 times drifts far enough
  // to show "99.99999999" where the label must read "100".
  return Array.from({ length: count + 1 }, (_, index) => first + index * steps.minorMm);
}

type TickKind = 'major' | 'half' | 'minor';

function tickKind(mm: number, steps: Steps): TickKind {
  if (isMultiple(mm, steps.labelMm)) return 'major';
  if (steps.subdivisions % 2 === 0 && isMultiple(mm, steps.labelMm / 2)) return 'half';
  return 'minor';
}

function tickLength(kind: TickKind): number {
  if (kind === 'major') return MAJOR_TICK_PX;
  return kind === 'half' ? HALF_TICK_PX : MINOR_TICK_PX;
}

function isMultiple(value: number, step: number): boolean {
  if (!(step > 0)) return false;
  const ratio = value / step;
  return Math.abs(ratio - Math.round(ratio)) < 1e-6;
}
