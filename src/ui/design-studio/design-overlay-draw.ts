// design-overlay-draw — the interaction layer (ADR-272, DS-3).
//
// This is the SECOND canvas, stacked above the static one, and the whole reason
// the Studio feels smooth: it carries everything that changes per pointer move —
// the live draft, its dimension label, the selection marquee — so a mouse move
// never re-strokes the committed drawing underneath.
//
// The dimension label is Figma's modifier-free version of the same idea: the
// measurement appears only while a gesture is live, so the canvas stays clean the
// rest of the time.

import type { SketchEntity } from '../../core/design';
import type { SnapTarget } from '../../core/design/snap';
import type { Vec2 } from '../../core/scene';
import { canvasTheme } from '../theme/canvas-theme';
import { formatDisplayMillimetres } from '../format-display-millimetres';
import {
  circleCentreMm,
  circleRadiusMm,
  draftAngleDeg,
  draftLengthMm,
  draftRectMm,
  lineEndMm,
  type DesignDraft,
} from './design-draft';
import { paintAnnotation } from './design-annotation-draw';
import { annotationFor } from './design-measure-annotation';
import { paintSnapMarker } from './design-snap-marker-draw';
import { formatFieldValue, type EntityField } from './design-field-format';
import type { DesignMarquee, DesignView } from './design-session';
import { mmToPx } from './design-view';

export type DesignOverlayPaint = {
  readonly view: DesignView;
  readonly draft: DesignDraft | null;
  readonly marquee: DesignMarquee | null;
  // The entity the inspector is showing, plus the field being touched. Together
  // they produce the dimension call-out drawn over the shape.
  readonly measuredEntity: SketchEntity | null;
  readonly measuredField: EntityField | null;
  // The geometric snap under the pointer, marked with a per-kind glyph.
  readonly snap: SnapTarget | null;
  readonly widthPx: number;
  readonly heightPx: number;
};

const DRAFT_LINE_WIDTH_PX = 1.5;
const MARQUEE_DASH_PX: ReadonlyArray<number> = [4, 3];
const LABEL_FONT = '11px system-ui, sans-serif';
const LABEL_PADDING_PX = 4;
const LABEL_OFFSET_PX = 12;
const LABEL_HEIGHT_PX = 16;
const TAU = Math.PI * 2;

export function paintDesignOverlay(ctx: CanvasRenderingContext2D, paint: DesignOverlayPaint): void {
  ctx.clearRect(0, 0, paint.widthPx, paint.heightPx);
  if (paint.marquee !== null) paintMarquee(ctx, paint.view, paint.marquee);
  if (paint.draft !== null) paintDraft(ctx, paint.view, paint.draft);
  paintMeasurement(ctx, paint);
  // Drawn last so the snap glyph is never hidden behind a draft or a dimension.
  if (paint.snap !== null) paintSnapMarker(ctx, paint.view, paint.snap);
}

// Drawn last so a dimension call-out is never hidden behind a draft.
function paintMeasurement(ctx: CanvasRenderingContext2D, paint: DesignOverlayPaint): void {
  const entity = paint.measuredEntity;
  const field = paint.measuredField;
  if (entity === null || field === null) return;
  const annotation = annotationFor(entity, field.key);
  if (annotation === null) return;
  paintAnnotation(ctx, paint.view, annotation, formatFieldValue(field));
}

function paintMarquee(
  ctx: CanvasRenderingContext2D,
  view: DesignView,
  marquee: DesignMarquee,
): void {
  const a = mmToPx(view, marquee.anchorMm);
  const b = mmToPx(view, marquee.pointerMm);
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  ctx.fillStyle = canvasTheme.selectionMarqueeFill;
  ctx.fillRect(x, y, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  ctx.strokeStyle = canvasTheme.selection;
  ctx.lineWidth = 1;
  ctx.setLineDash([...MARQUEE_DASH_PX]);
  ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  ctx.setLineDash([]);
}

function paintDraft(ctx: CanvasRenderingContext2D, view: DesignView, draft: DesignDraft): void {
  ctx.strokeStyle = canvasTheme.selection;
  ctx.lineWidth = DRAFT_LINE_WIDTH_PX;
  ctx.setLineDash([]);
  switch (draft.tool) {
    case 'line':
      paintDraftLine(ctx, view, draft);
      break;
    case 'rect':
      paintDraftRect(ctx, view, draft);
      break;
    case 'circle':
      paintDraftCircle(ctx, view, draft);
      break;
  }
}

function paintDraftLine(ctx: CanvasRenderingContext2D, view: DesignView, draft: DesignDraft): void {
  const from = mmToPx(view, draft.anchorMm);
  const to = mmToPx(view, lineEndMm(draft));
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  drawLabel(
    ctx,
    to,
    `${formatDisplayMillimetres(draftLengthMm(draft))} mm  ${formatDisplayMillimetres(
      draftAngleDeg(draft),
    )}°`,
  );
}

function paintDraftRect(ctx: CanvasRenderingContext2D, view: DesignView, draft: DesignDraft): void {
  const rect = draftRectMm(draft);
  const origin = mmToPx(view, rect.origin);
  const far = mmToPx(view, {
    x: rect.origin.x + rect.widthMm,
    y: rect.origin.y + rect.heightMm,
  });
  ctx.strokeRect(origin.x, origin.y, far.x - origin.x, far.y - origin.y);
  drawLabel(
    ctx,
    { x: far.x, y: far.y },
    `${formatDisplayMillimetres(rect.widthMm)} × ${formatDisplayMillimetres(rect.heightMm)} mm`,
  );
}

function paintDraftCircle(
  ctx: CanvasRenderingContext2D,
  view: DesignView,
  draft: DesignDraft,
): void {
  const centre = mmToPx(view, circleCentreMm(draft));
  const radiusMm = circleRadiusMm(draft);
  const radiusPx = radiusMm * view.pxPerMm;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, Math.max(0, radiusPx), 0, TAU);
  ctx.stroke();
  drawLabel(
    ctx,
    { x: centre.x + radiusPx, y: centre.y },
    `⌀ ${formatDisplayMillimetres(radiusMm * 2)} mm`,
  );
}

// A filled chip rather than bare text, so the number stays readable over grid
// lines and geometry alike.
function drawLabel(ctx: CanvasRenderingContext2D, atPx: Vec2, text: string): void {
  ctx.font = LABEL_FONT;
  const width = ctx.measureText(text).width + LABEL_PADDING_PX * 2;
  const x = atPx.x + LABEL_OFFSET_PX;
  const y = atPx.y + LABEL_OFFSET_PX;
  ctx.fillStyle = canvasTheme.noticeFill;
  ctx.fillRect(x, y, width, LABEL_HEIGHT_PX);
  ctx.strokeStyle = canvasTheme.selection;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, width, LABEL_HEIGHT_PX);
  ctx.fillStyle = canvasTheme.designGeometry;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + LABEL_PADDING_PX, y + LABEL_HEIGHT_PX / 2);
}
