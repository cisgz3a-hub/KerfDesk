// draw-registration-dimensions — a size label on the captured-board / jig
// outline (ADR-124). Renders "W × H mm" just below the registration box so the
// operator can read what the laser measured and check it against a physical
// ruler. Screen-space text (fixed px) so it stays legible at any zoom; reads the
// box's actual drawn bounds, so it reflects exactly what's on the canvas.

import {
  findRegistrationBoxes,
  sceneObjectHasVisibleLayer,
  transformedBBox,
  type Project,
  type ShapeObject,
} from '../../core/scene';
import { canvasTheme } from '../theme/canvas-theme';
import type { ViewTransform } from './view-transform';

const LABEL_FONT = '12px system-ui, sans-serif';
const LABEL_HEIGHT_PX = 16;
const LABEL_GAP_PX = 6;
const LABEL_PAD_X_PX = 5;
const LABEL_PAD_Y_PX = 2;

export function drawRegistrationBoxDimensions(
  ctx: CanvasRenderingContext2D,
  project: Project,
  view: ViewTransform,
): void {
  const boxes = findRegistrationBoxes(project.scene);
  if (boxes.length === 0) return;
  ctx.save();
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const box of boxes) {
    // Hiding the registration layer skips drawing the outline (draw-scene), so
    // the label must hide with it — otherwise it floats with no box.
    if (!sceneObjectHasVisibleLayer(project.scene, box)) continue;
    const bbox = transformedBBox(box);
    const label = dimensionLabel(box);
    const centerX = view.offsetX + ((bbox.minX + bbox.maxX) / 2) * view.scale;
    const belowY = view.offsetY + bbox.maxY * view.scale + LABEL_GAP_PX;
    drawLabel(ctx, label, centerX, belowY);
  }
  ctx.restore();
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  top: number,
): void {
  const width = ctx.measureText(text).width + LABEL_PAD_X_PX * 2;
  // Light chip behind the text so it stays readable over the grid lines.
  ctx.fillStyle = canvasTheme.noticeFill;
  ctx.fillRect(centerX - width / 2, top, width, LABEL_HEIGHT_PX);
  ctx.fillStyle = canvasTheme.measureStroke;
  ctx.fillText(text, centerX, top + LABEL_PAD_Y_PX);
}

// A rectangle board reads "W × H mm"; a circle board (an ellipse) reads its
// diameter "⌀ D mm" to match the panel's readout, not the bounding square. Local
// bounds × scale keeps it rotation-invariant — the axis-aligned bbox would
// inflate W/H once the box is rotated (a 100×60 board at 45° would read ~113×113).
function dimensionLabel(box: ShapeObject): string {
  const widthMm = (box.bounds.maxX - box.bounds.minX) * Math.abs(box.transform.scaleX);
  const heightMm = (box.bounds.maxY - box.bounds.minY) * Math.abs(box.transform.scaleY);
  if (box.spec.kind === 'ellipse') return `⌀ ${formatMm(widthMm)} mm`;
  return `${formatMm(widthMm)} × ${formatMm(heightMm)} mm`;
}

function formatMm(mm: number): string {
  return mm.toFixed(1);
}
