// Turns a barcode spec plus one evaluated data value into the object's
// engraving geometry. Human-readable text needs an outline font, which is
// loaded outside core, so callers pass a caption renderer backed by the same
// text pipeline as text objects; matrix codes and captionless 1D codes never
// call it. Everything lands in one even-odd path so glyphs and inverted
// modules stay holes in an inverted plate.

import {
  IDENTITY_TRANSFORM,
  polylineToCurveSubpath,
  type Bounds,
  type ColoredPath,
  type CurveSubpath,
  type PathSegment,
  type Polyline,
  type ShapeObject,
  type Transform,
  type Vec2,
} from '../scene';
import type { BarcodeShape } from '../scene/scene-object';
import { DEFAULT_FONT_KEY } from '../text';
import { layoutBarcode, layoutPolylines, type BarcodeLayout } from './barcode-layout';

/** Captions use the bundled sans font; its digits are tabular like OCR-B's. */
export const BARCODE_CAPTION_FONT_KEY = DEFAULT_FONT_KEY;

export type RenderedCaption = {
  readonly polylines: readonly Polyline[];
  readonly curves?: readonly CurveSubpath[] | undefined;
  /** Ink bounds in the renderer's own coordinates. */
  readonly bounds: Bounds;
};

export type BarcodeCaptionRenderer = (caption: {
  readonly text: string;
  readonly sizeMm: number;
}) => Promise<RenderedCaption>;

export type MaterializedBarcode = {
  readonly paths: readonly ColoredPath[];
  readonly bounds: Bounds;
  readonly layout: BarcodeLayout;
};

export type MaterializeBarcodeResult =
  | { readonly ok: true; readonly barcode: MaterializedBarcode }
  | { readonly ok: false; readonly message: string };

export async function materializeBarcode(
  spec: BarcodeShape,
  value: string,
  color: string,
  renderCaption: BarcodeCaptionRenderer,
): Promise<MaterializeBarcodeResult> {
  const laid = layoutBarcode(spec, value);
  if (!laid.ok) return laid;
  const layout = laid.layout;
  const glyphs: { polylines: Polyline[]; curves: CurveSubpath[] } = { polylines: [], curves: [] };
  let bottom = layout.heightMm;
  for (const caption of layout.captions) {
    if (caption.text.trim() === '') continue;
    let rendered: RenderedCaption;
    try {
      rendered = await renderCaption({ text: caption.text, sizeMm: caption.sizeMm });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, message: `The barcode text could not be drawn: ${reason}` };
    }
    const dx = caption.centerXMm - (rendered.bounds.minX + rendered.bounds.maxX) / 2;
    const dy = caption.topMm - rendered.bounds.minY;
    appendTranslated(glyphs, rendered, dx, dy);
    bottom = Math.max(bottom, rendered.bounds.maxY + dy + layout.paddingMm);
  }
  const marks = layoutPolylines(layout, bottom);
  const path: ColoredPath = {
    color,
    polylines: [...marks, ...glyphs.polylines],
    curves: [...marks.map(polylineToCurveSubpath), ...glyphs.curves],
    fillRule: 'evenodd',
  };
  const bounds = { minX: 0, minY: 0, maxX: layout.widthMm, maxY: bottom };
  return { ok: true, barcode: { paths: [path], bounds, layout } };
}

/** A new barcode shape object, or the reason its data cannot be encoded. */
export async function createBarcodeObject(args: {
  readonly id: string;
  readonly color: string;
  readonly spec: BarcodeShape;
  readonly value: string;
  readonly renderCaption: BarcodeCaptionRenderer;
  readonly transform?: Transform;
}): Promise<
  | { readonly ok: true; readonly object: ShapeObject }
  | { readonly ok: false; readonly message: string }
> {
  const result = await materializeBarcode(args.spec, args.value, args.color, args.renderCaption);
  if (!result.ok) return result;
  return {
    ok: true,
    object: {
      kind: 'shape',
      id: args.id,
      spec: args.spec,
      color: args.color,
      bounds: result.barcode.bounds,
      transform: args.transform ?? IDENTITY_TRANSFORM,
      paths: result.barcode.paths,
    },
  };
}

function appendTranslated(
  target: { polylines: Polyline[]; curves: CurveSubpath[] },
  rendered: RenderedCaption,
  dx: number,
  dy: number,
): void {
  const move = (point: Vec2): Vec2 => ({ x: point.x + dx, y: point.y + dy });
  const polylines = rendered.polylines.map((polyline) => ({
    ...polyline,
    points: polyline.points.map(move),
  }));
  target.polylines.push(...polylines);
  // Curves must pair one-to-one with polylines; fall back to straight segments.
  const curves =
    rendered.curves !== undefined && rendered.curves.length === rendered.polylines.length
      ? rendered.curves.map((curve) => ({
          ...curve,
          start: move(curve.start),
          segments: curve.segments.map((segment) => moveSegment(segment, move)),
        }))
      : polylines.map(polylineToCurveSubpath);
  target.curves.push(...curves);
}

function moveSegment(segment: PathSegment, move: (point: Vec2) => Vec2): PathSegment {
  if (segment.kind === 'cubic') {
    return {
      ...segment,
      control1: move(segment.control1),
      control2: move(segment.control2),
      to: move(segment.to),
    };
  }
  return { ...segment, to: move(segment.to) };
}
