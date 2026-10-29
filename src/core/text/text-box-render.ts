import { transformCurveSubpathUniform, type TextAlignment } from '../scene';
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
 * A frame puts each render's ink top at its top, so variable records with and
 * without capitals or accents would burn on different baselines. Each record
 * moves to the template's first baseline scaled to its own size, so records
 * the frame gives one size share a baseline whatever size the template took.
 * A glyph taller than the template's rises above the frame top and the layout
 * reports overflow. A record whose ink fills the frame's height cannot move
 * without leaving it, so it keeps the frame's rule (ADR-682 Amendment 1).
 */
export function onTextBoxBaseline(
  record: TextRenderResult,
  template: TextBoxBaseline | undefined,
): TextRenderResult {
  const own = textBoxBaseline(record);
  const layout = record.textBoxLayout;
  if (template === undefined || own === undefined || layout === undefined) return record;
  if (!(template.sizeMm > 0)) return record;
  const { minY, maxY } = record.bounds;
  if (maxY - minY >= layout.heightMm - 1e-7) return record;
  const dy = (template.y * own.sizeMm) / template.sizeMm - own.y;
  if (dy === 0) return record;
  const move = { scale: 1, translateX: 0, translateY: dy };
  return {
    ...record,
    paths: record.paths.map((path) => ({
      ...path,
      polylines: path.polylines.map((line) => ({
        ...line,
        points: line.points.map((point) => ({ x: point.x, y: point.y + dy })),
      })),
      ...(path.curves === undefined
        ? {}
        : { curves: path.curves.map((curve) => transformCurveSubpathUniform(curve, move)) }),
    })),
    bounds: { ...record.bounds, minY: minY + dy, maxY: maxY + dy },
    anchor: { x: record.anchor?.x ?? 0, y: own.y + dy },
    textBoxLayout: {
      ...layout,
      overflow: layout.overflow || minY + dy < -1e-7 || maxY + dy > layout.heightMm + 1e-7,
    },
  };
}
