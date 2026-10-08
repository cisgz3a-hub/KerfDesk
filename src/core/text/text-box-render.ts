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
  return {
    ...rendered,
    paths,
    bounds: { minX: x, minY: 0, maxX: x + width, maxY: height },
    anchor: { x: 0, y: 0 },
    textBoxLayout: {
      ...layout,
      widthMm: frameWidth,
      heightMm: frameHeight,
      sizeMm: layout.sizeMm * scale,
      overflow: layout.overflow || width > frameWidth + 1e-7 || height > frameHeight + 1e-7,
    },
  };
}
