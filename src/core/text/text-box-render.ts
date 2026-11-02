import { transformCurveSubpathUniform, type Bounds, type TextAlignment } from '../scene';
import type { TextBoxSettings } from '../scene/text-box';
import type { TextRenderResult } from './text-to-polylines';
import type { TextBoxLayout } from './text-box-layout';

/** Preserve native curves and expose overflow; a frame never hides machining geometry. */
export function finishTextBoxRender(
  rendered: TextRenderResult,
  layout: TextBoxLayout,
  box: TextBoxSettings,
  alignment: TextAlignment,
): TextRenderResult {
  const inkWidth = rendered.bounds.maxX - rendered.bounds.minX;
  const inkHeight = rendered.bounds.maxY - rendered.bounds.minY;
  const allowedScale =
    box.mode === 'fixed' && box.fit === 'shrink'
      ? Math.min(
          1,
          layout.widthMm / Math.max(inkWidth, 1e-9),
          layout.heightMm / Math.max(inkHeight, 1e-9),
        )
      : 1;
  const scale = Math.max(Math.min(1, box.minSizeMm / layout.sizeMm), allowedScale);
  const width = inkWidth * scale,
    height = inkHeight * scale;
  const frameWidth =
    box.mode === 'auto-width' ? Math.max(width, layout.widthMm * scale) : layout.widthMm;
  const frameHeight =
    box.mode === 'fixed' ? layout.heightMm : Math.max(height, layout.heightMm * scale);
  const x = alignment === 'left' ? 0 : (frameWidth - width) * (alignment === 'center' ? 0.5 : 1);
  const paths = rendered.paths.map((path) => ({
    ...path,
    polylines: path.polylines.map((line) => ({
      ...line,
      points: line.points.map((point) => ({ x: point.x * scale + x, y: point.y * scale })),
    })),
    ...(path.curves === undefined
      ? {}
      : {
          curves: path.curves.map((curve) =>
            transformCurveSubpathUniform(curve, { scale, translateX: x, translateY: 0 }),
          ),
        }),
  }));
  // The frame places the ink, so its anchor is the frame's left edge, centre
  // or right edge on the first baseline (ADR-682).
  const anchorX = alignment === 'left' ? 0 : frameWidth * (alignment === 'center' ? 0.5 : 1);
  const { anchor: _ink, ...unanchored } = rendered;
  return {
    ...unanchored,
    paths,
    bounds: { minX: x, minY: 0, maxX: x + width, maxY: height },
    ...(rendered.anchor === undefined
      ? {}
      : { anchor: { x: anchorX, y: rendered.anchor.y * scale } }),
    textBoxLayout: {
      ...layout,
      widthMm: frameWidth,
      heightMm: frameHeight,
      sizeMm: layout.sizeMm * scale,
      overflow: layout.overflow || width > frameWidth + 1e-7 || height > frameHeight + 1e-7,
    },
  };
}

/** Where a frame's first baseline sits, at the size the frame laid it out. */
export type TextBoxBaseline = { readonly sizeMm: number; readonly y: number };

export function textBoxBaseline(rendered: TextRenderResult): TextBoxBaseline | undefined {
  const sizeMm = rendered.textBoxLayout?.sizeMm;
  return sizeMm === undefined || rendered.anchor === undefined
    ? undefined
    : { sizeMm, y: rendered.anchor.y };
}

/**
 * How far a render's ink passes the frame edges the user typed: all four of a
 * fixed frame, the sides of an Auto height frame, none of an Auto width frame.
 * Each axis is the larger of its two edges.
 */
export function textBoxOverflowMm(
  bounds: Bounds,
  layout: TextBoxLayout,
  box: TextBoxSettings,
): { readonly widthMm: number; readonly heightMm: number } {
  const past = (low: number, high: number, size: number): number => Math.max(0, -low, high - size);
  return {
    widthMm: box.mode === 'auto-width' ? 0 : past(bounds.minX, bounds.maxX, layout.widthMm),
    heightMm: box.mode === 'fixed' ? past(bounds.minY, bounds.maxY, layout.heightMm) : 0,
  };
}

/**
 * A frame puts each render's ink top at its top, so variable records with and
 * without capitals or accents would burn on different baselines. Each record
 * moves to the template's first baseline scaled to its own size, so records
 * the frame gives one size share a baseline whatever size the template took.
 *
 * A glyph taller than the template's rises above the frame top and the layout
 * reports overflow; no size cures that, because the baseline scales with the
 * glyph. A record whose ink fills the frame's height cannot move without
 * leaving it, so it keeps the frame's rule (ADR-682 Amendment 1). In a
 * shrink-to-fit frame, a record the baseline would carry past the bottom
 * shrinks until it fits on that baseline (ADR-682 Amendment 2).
 */
export function onTextBoxBaseline(
  record: TextRenderResult,
  template: TextBoxBaseline | undefined,
  box: TextBoxSettings | undefined,
): TextRenderResult {
  const own = textBoxBaseline(record);
  const layout = record.textBoxLayout;
  if (template === undefined || own === undefined || layout === undefined) return record;
  if (box === undefined || !(template.sizeMm > 0)) return record;
  const { minX, maxX, minY, maxY } = record.bounds;
  if (maxY - minY >= layout.heightMm - 1e-7) return record;
  const baselineY = (template.y * own.sizeMm) / template.sizeMm;
  const scale = bottomRefitScale(baselineY + maxY - own.y, own.sizeMm, layout.heightMm, box);
  if (baselineY === own.y && scale === 1) return record;
  // The alignment point stays put across the frame, so a refit record stays
  // left, centred or right in it.
  const anchorX = record.anchor?.x ?? 0;
  const move = {
    scale,
    translateX: anchorX * (1 - scale),
    translateY: (baselineY - own.y) * scale,
  };
  const bounds = {
    minX: minX * scale + move.translateX,
    maxX: maxX * scale + move.translateX,
    minY: minY * scale + move.translateY,
    maxY: maxY * scale + move.translateY,
  };
  return {
    ...record,
    paths: movedPaths(record.paths, move),
    bounds,
    anchor: { x: anchorX, y: baselineY * scale },
    textBoxLayout: {
      ...layout,
      sizeMm: own.sizeMm * scale,
      overflow: layout.overflow || passesFrame(bounds, layout, box),
    },
  };
}

function passesFrame(bounds: Bounds, layout: TextBoxLayout, box: TextBoxSettings): boolean {
  const { widthMm, heightMm } = textBoxOverflowMm(bounds, layout, box);
  return widthMm > 1e-7 || heightMm > 1e-7;
}

function movedPaths(
  paths: TextRenderResult['paths'],
  move: { readonly scale: number; readonly translateX: number; readonly translateY: number },
): TextRenderResult['paths'] {
  return paths.map((path) => ({
    ...path,
    polylines: path.polylines.map((line) => ({
      ...line,
      points: line.points.map((point) => ({
        x: point.x * move.scale + move.translateX,
        y: point.y * move.scale + move.translateY,
      })),
    })),
    ...(path.curves === undefined
      ? {}
      : { curves: path.curves.map((curve) => transformCurveSubpathUniform(curve, move)) }),
  }));
}

// Baseline and ink both scale with the record, so the bottom scales linearly
// from the frame top. The frame's smallest size still holds; a record that
// needs less overflows and says so.
function bottomRefitScale(
  bottomMm: number,
  sizeMm: number,
  frameHeightMm: number,
  box: TextBoxSettings,
): number {
  if (box.mode !== 'fixed' || box.fit !== 'shrink' || bottomMm <= frameHeightMm + 1e-7) return 1;
  return Math.max(frameHeightMm / bottomMm, Math.min(1, box.minSizeMm / sizeMm));
}
