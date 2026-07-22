// Text rasterization for the Image Studio (ADR-246, V2 plan C). Renders
// glyphs with Canvas2D fillText using the SAME bundled fonts as the vector
// text feature (registered as CSS FontFaces, family lf2-<key>), so a raster
// text layer matches the app's typography. Browser-only (needs a canvas);
// the pure layer insertion lives in editor-session-layers (addTextLayer).

import type { PaintColor, RgbaBuffer } from '../../core/image-edit';
import { cssFamilyForFont, ensureFontCss } from '../text/font-loader';

const LINE_HEIGHT_FACTOR = 1.25;

export type TextLayerSpec = {
  readonly text: string;
  /** An outline FontEntry key (single-line fonts are vector-only). */
  readonly fontKey: OutlineFontKey;
  readonly sizePx: number;
  readonly color: PaintColor;
};

type OutlineFontKey = Parameters<typeof ensureFontCss>[0];

/**
 * Render the text centred into a NEW transparent doc-sized buffer. Awaits the
 * font CSS so the glyphs are hinted, not the system fallback. Returns null
 * for empty text or when no 2D context is available.
 */
export async function rasterizeTextLayer(
  docWidth: number,
  docHeight: number,
  spec: TextLayerSpec,
): Promise<RgbaBuffer | null> {
  const lines = spec.text.split('\n');
  if (spec.text.trim().length === 0) return null;
  await ensureFontCss(spec.fontKey);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, docWidth);
  canvas.height = Math.max(1, docHeight);
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;

  ctx.font = `${spec.sizePx}px ${cssFamilyForFont(spec.fontKey)}`;
  ctx.fillStyle = `rgb(${spec.color.r}, ${spec.color.g}, ${spec.color.b})`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const lineHeight = spec.sizePx * LINE_HEIGHT_FACTOR;
  const blockTop = docHeight / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => {
    ctx.fillText(line, docWidth / 2, blockTop + index * lineHeight);
  });

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: image.data };
}
