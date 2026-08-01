// viewport-overlay — the sketch as line-segment buffers in the viewport's
// LOCAL frame (ADR-272 Amendment 2). PURE: entities in, Float32Arrays out —
// no three import, so the geometry the viewport draws is testable without
// WebGL, the same seam ADR-102 §2 demands of every 3D drawable.
//
// One bucket per stroke style. Selection beats construction beats the layer
// colour, mirroring the 2D painter, so the two surfaces tell one story.

import { entityToPolylines, type Sketch, type SketchEntity } from '../../../core/design';
import { entityDesignLayer, sketchLayers } from '../../../core/design/layers';
import type { Polyline, Vec2 } from '../../../core/scene';
import { localFromScene } from '../../cnc-viewer3d/viewer3d-picking';
import { canvasTheme } from '../../theme/canvas-theme';
import { draftToEntity, type DesignDraft } from '../design-draft';
import { resizeHandles, selectionBounds } from '../design-handles';

// Floats the sketch just above the stock top so lines never z-fight the
// carved surface. Small enough to read as "on" the material.
export const OVERLAY_LIFT_MM = 0.25;

export type OverlayFrame = {
  // Scene-space min corner of the stock (the frame the carve grid stamps in).
  readonly originMm: Vec2;
  readonly widthMm: number;
  readonly heightMm: number;
};

export type OverlayBucket = {
  // Lowercase #rrggbb. Scene DATA (layer colours) plus the shared selection
  // and construction strokes from canvasTheme.
  readonly color: string;
  readonly dashed: boolean;
  // x0,y0,z0, x1,y1,z1 … — LOCAL frame, pairs per segment (LineSegments2).
  readonly positions: Float32Array;
};

export type ViewportOverlay = {
  readonly buckets: ReadonlyArray<OverlayBucket>;
  // Snap marker position in the local frame, or null when nothing is captured.
  readonly snapLocal: { readonly x: number; readonly y: number; readonly z: number } | null;
  // Resize grips on the selection's corners, in the local frame. Drawn at a
  // constant screen size by the renderer, so no millimetre size is given here.
  readonly handlesLocal: ReadonlyArray<{
    readonly x: number;
    readonly y: number;
    readonly z: number;
  }>;
};

export type ViewportOverlayInput = {
  readonly sketch: Sketch;
  readonly selectedIds: ReadonlySet<string>;
  readonly draft: DesignDraft | null;
  readonly snapMm: Vec2 | null;
  readonly frame: OverlayFrame;
};

export function buildViewportOverlay(input: ViewportOverlayInput): ViewportOverlay {
  const layers = sketchLayers(input.sketch);
  const segments = new Map<string, { dashed: boolean; points: number[] }>();
  const push = (key: string, dashed: boolean, polylines: ReadonlyArray<Polyline>): void => {
    const bucket = segments.get(key) ?? { dashed, points: [] };
    for (const polyline of polylines) appendPolylineSegments(bucket.points, polyline, input.frame);
    segments.set(key, bucket);
  };

  for (const entity of input.sketch.entities) {
    const key = input.selectedIds.has(entity.id)
      ? canvasTheme.selection
      : entity.construction === true
        ? canvasTheme.designConstruction
        : entityDesignLayer(entity, layers).color;
    const dashed = entity.construction === true && !input.selectedIds.has(entity.id);
    push(dashed ? `${key}|dash` : key, dashed, entityToPolylines(entity));
  }

  const draftEntity = input.draft === null ? null : draftToEntity(input.draft, 'draft-preview');
  if (draftEntity !== null) push(canvasTheme.selection, false, draftEntityPolylines(draftEntity));

  const buckets = [...segments.entries()]
    .filter(([, bucket]) => bucket.points.length > 0)
    .map(([key, bucket]) => ({
      color: key.split('|')[0] ?? canvasTheme.designGeometry,
      dashed: bucket.dashed,
      positions: new Float32Array(bucket.points),
    }));

  const snapLocal =
    input.snapMm === null
      ? null
      : localFromScene(
          { x: input.snapMm.x, y: input.snapMm.y, z: OVERLAY_LIFT_MM },
          input.frame.originMm,
          input.frame,
        );
  const handlesLocal = resizeHandles(selectionBounds(input.sketch, input.selectedIds)).map(
    (handle) =>
      localFromScene(
        { x: handle.atMm.x, y: handle.atMm.y, z: OVERLAY_LIFT_MM },
        input.frame.originMm,
        input.frame,
      ),
  );
  return { buckets, snapLocal, handlesLocal };
}

function draftEntityPolylines(entity: SketchEntity): ReadonlyArray<Polyline> {
  return entityToPolylines(entity);
}

function appendPolylineSegments(out: number[], polyline: Polyline, frame: OverlayFrame): void {
  const points = polyline.points;
  if (points.length < 2) return;
  const count = polyline.closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a === undefined || b === undefined) continue;
    pushLocal(out, a, frame);
    pushLocal(out, b, frame);
  }
}

function pushLocal(out: number[], point: Vec2, frame: OverlayFrame): void {
  const local = localFromScene(
    { x: point.x, y: point.y, z: OVERLAY_LIFT_MM },
    frame.originMm,
    frame,
  );
  out.push(local.x, local.y, local.z);
}
