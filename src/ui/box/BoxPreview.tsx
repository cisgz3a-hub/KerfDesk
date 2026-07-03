// BoxPreview — a small canvas that strokes the generated panel sheet with
// its panel names (F-K1: names are shown here; inserted scene objects carry
// none). Pure draw-on-props; the dialog keeps the last valid sheet visible
// while the draft is invalid.

import { useEffect, useRef } from 'react';
import type { BoxPanel } from '../../core/box';

const PREVIEW_WIDTH_PX = 420;
const PREVIEW_HEIGHT_PX = 180;
const PREVIEW_MARGIN_PX = 8;
const LABEL_FONT = '10px system-ui, sans-serif';

/* eslint-disable no-restricted-syntax -- deliberate light-surface literals
   (always-light generated-sheet preview canvas, ADR-047 exception). */
const SHEET_BACKGROUND = '#ffffff';
const PANEL_STROKE = '#1a1a1a';
const LABEL_FILL = '#666666';
/* eslint-enable no-restricted-syntax */

export function BoxPreview(props: {
  readonly panels: ReadonlyArray<BoxPanel> | null;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = context2d(canvas);
    if (ctx === null) return;
    drawSheet(ctx, props.panels);
  }, [props.panels]);
  return (
    <canvas
      ref={canvasRef}
      width={PREVIEW_WIDTH_PX}
      height={PREVIEW_HEIGHT_PX}
      role="img"
      aria-label="Generated panel sheet preview"
      style={{ width: '100%', border: '1px solid var(--lf-border)', borderRadius: 4 }}
    />
  );
}

// jsdom throws "Not implemented" instead of returning null; the preview is
// decorative, so a missing 2D context just skips drawing.
function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return canvas.getContext('2d');
  } catch {
    return null;
  }
}

function drawSheet(ctx: CanvasRenderingContext2D, panels: ReadonlyArray<BoxPanel> | null): void {
  ctx.fillStyle = SHEET_BACKGROUND;
  ctx.fillRect(0, 0, PREVIEW_WIDTH_PX, PREVIEW_HEIGHT_PX);
  if (panels === null || panels.length === 0) return;
  const points = panels.flatMap((panel) => panel.outline.points);
  const maxX = Math.max(...points.map((p) => p.x));
  const maxY = Math.max(...points.map((p) => p.y));
  const scale = Math.min(
    (PREVIEW_WIDTH_PX - 2 * PREVIEW_MARGIN_PX) / Math.max(maxX, 1),
    (PREVIEW_HEIGHT_PX - 2 * PREVIEW_MARGIN_PX) / Math.max(maxY, 1),
  );
  ctx.save();
  ctx.translate(PREVIEW_MARGIN_PX, PREVIEW_MARGIN_PX);
  ctx.strokeStyle = PANEL_STROKE;
  ctx.lineWidth = 1;
  for (const panel of panels) {
    ctx.beginPath();
    panel.outline.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x * scale, point.y * scale);
      else ctx.lineTo(point.x * scale, point.y * scale);
    });
    ctx.stroke();
    drawLabel(ctx, panel, scale);
  }
  ctx.restore();
}

function drawLabel(ctx: CanvasRenderingContext2D, panel: BoxPanel, scale: number): void {
  const xs = panel.outline.points.map((p) => p.x);
  const ys = panel.outline.points.map((p) => p.y);
  const centerX = ((Math.min(...xs) + Math.max(...xs)) / 2) * scale;
  const centerY = ((Math.min(...ys) + Math.max(...ys)) / 2) * scale;
  ctx.fillStyle = LABEL_FILL;
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(panel.name, centerX, centerY);
}
