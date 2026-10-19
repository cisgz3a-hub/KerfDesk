import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  findRegistrationBoxes,
  sceneObjectHasVisibleLayer,
  transformedBBox,
  type AABB,
  type Project,
  type Vec2,
} from '../../../core/scene';
import { canvasTheme } from '../../theme/canvas-theme';
import { createDisplayPolylineCache } from '../display-polylines';
import { drawScene } from '../draw-scene';
import { drawSelectionMarquee } from '../draw-selection-marquee';
import { drawSelectionSetOverlay } from '../draw-selection-overlay';
import { computeView, type ViewState, type ViewTransform } from '../view-transform';
import { jigEditableSelection } from './jig-canvas-selection';
import { useLengthUnit } from '../../state/display-units';

export type JigMarquee = { readonly start: Vec2; readonly end: Vec2 };

export type JigCanvasOverlay = {
  readonly selectedIds: ReadonlySet<string>;
  /** Box selection in progress. */
  readonly marquee: JigMarquee | null;
  /** Outline that files dragged over the canvas would import into. */
  readonly dropOutlineId: string | null;
};

export function useJigCanvasPaint(
  ref: RefObject<HTMLCanvasElement>,
  displayed: Project,
  overlay: JigCanvasOverlay,
  size: { readonly width: number; readonly height: number },
  viewState: ViewState,
): void {
  const { selectedIds, marquee, dropOutlineId } = overlay;
  const [paintRevision, setPaintRevision] = useState(0);
  const cache = useRef(createDisplayPolylineCache());
  // The jig editor's rulers count in the operator's display unit (ADR-629).
  const lengthUnit = useLengthUnit();
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (canvas === null || ctx == null) return;
    const frame = requestAnimationFrame(() => {
      drawScene(ctx, size.width, size.height, displayed, {
        selectedId: null,
        preview: false,
        // This editor has no pulse or Alt peek, so operation colours stay visible.
        operationColors: true,
        view: viewState,
        displayPolylineCache: cache.current,
        onRasterBitmapReady: () => setPaintRevision((revision) => revision + 1),
        lengthUnit,
      });
      const view = computeView(
        size.width,
        size.height,
        displayed.device.bedWidth,
        displayed.device.bedHeight,
        viewState,
      );
      drawJigCanvasOverlay(ctx, displayed, { selectedIds, marquee, dropOutlineId }, view);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    ref,
    displayed,
    selectedIds,
    marquee,
    dropOutlineId,
    size,
    viewState,
    paintRevision,
    lengthUnit,
  ]);
}

export function drawJigCanvasOverlay(
  ctx: CanvasRenderingContext2D,
  project: Project,
  overlay: JigCanvasOverlay,
  view: ViewTransform,
): void {
  const outline = findRegistrationBoxes(project.scene).find(
    (box) => box.id === overlay.dropOutlineId,
  );
  if (outline !== undefined) drawDropTarget(ctx, transformedBBox(outline), view);
  drawJigSelection(ctx, project, overlay.selectedIds, view);
  if (overlay.marquee !== null) drawSelectionMarquee(ctx, overlay.marquee, view);
}

// Each selected object's bounds, then the handles on the bounds of the editable
// part of the selection: eight resize handles and the rotate handle.
function drawJigSelection(
  ctx: CanvasRenderingContext2D,
  project: Project,
  selectedIds: ReadonlySet<string>,
  view: ViewTransform,
): void {
  const selected = project.scene.objects.filter(
    (object) => selectedIds.has(object.id) && sceneObjectHasVisibleLayer(project.scene, object),
  );
  const editable = jigEditableSelection(project, selectedIds);
  ctx.save();
  // One editable object is outlined by the handle frame itself.
  if (selected.length > 1 || editable.length === 0) {
    ctx.strokeStyle = canvasTheme.selection;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    for (const object of selected) strokeBounds(ctx, transformedBBox(object), view);
  }
  if (editable.length > 0) drawSelectionSetOverlay(ctx, editable, view, { moveHandle: false });
  ctx.restore();
}

function drawDropTarget(ctx: CanvasRenderingContext2D, bounds: AABB, view: ViewTransform): void {
  ctx.save();
  ctx.fillStyle = canvasTheme.selectionMarqueeFill;
  ctx.strokeStyle = canvasTheme.selection;
  ctx.lineWidth = 3;
  ctx.fillRect(...screenRect(bounds, view));
  strokeBounds(ctx, bounds, view);
  ctx.restore();
}

function strokeBounds(ctx: CanvasRenderingContext2D, bounds: AABB, view: ViewTransform): void {
  ctx.strokeRect(...screenRect(bounds, view));
}

function screenRect(bounds: AABB, view: ViewTransform): [number, number, number, number] {
  return [
    bounds.minX * view.scale + view.offsetX,
    bounds.minY * view.scale + view.offsetY,
    (bounds.maxX - bounds.minX) * view.scale,
    (bounds.maxY - bounds.minY) * view.scale,
  ];
}
