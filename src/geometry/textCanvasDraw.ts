/**
 * Canvas text layout for TextGeometry — shared by SceneRenderer, bounds, hit-test, and text-to-path.
 */

import type { TextGeometry } from '../core/scene/SceneObject';
import {
  layoutTextGeometry,
  measureTextLayoutLineWidth,
  splitTextGeometryLines,
  textLetterSpacing,
  textLineSpacing,
  textWordSpacingExtra,
} from './textLayout';

/** Some browsers apply CSS `letterSpacing` on 2D context — reset so our manual spacing is exact. */
function resetCanvasLetterSpacing(ctx: CanvasRenderingContext2D): void {
  try {
    const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
    if ('letterSpacing' in c) c.letterSpacing = '0px';
  } catch {
    /* ignore */
  }
}

export function applyTextGeometryFont(ctx: CanvasRenderingContext2D, g: TextGeometry): number {
  resetCanvasLetterSpacing(ctx);
  const fontSize = Math.max(0.01, g.fontSize || 10);
  const ff = g.fontFamily || 'Arial';
  const bold = g.bold ? 'bold ' : '';
  const italic = g.italic ? 'italic ' : '';
  ctx.font = `${bold}${italic}${fontSize}px ${ff}`;
  return fontSize;
}

/** Pixel width of one line including letter and word spacing. */
export function measureTextLineWidth(ctx: CanvasRenderingContext2D, g: TextGeometry, line: string): number {
  const fontSize = applyTextGeometryFont(ctx, g);
  const ls = textLetterSpacing(g, fontSize);
  const ws = textWordSpacingExtra(g, fontSize);
  if (Math.abs(ls) < 1e-9 && Math.abs(ws) < 1e-9) {
    return ctx.measureText(line).width;
  }
  return measureTextLayoutLineWidth({ ...g, text: line }, ch => ctx.measureText(ch).width);
}

/** Local-space width and height of the full text block. */
export function measureTextGeometrySize(ctx: CanvasRenderingContext2D, g: TextGeometry): { width: number; height: number } {
  const fontSize = applyTextGeometryFont(ctx, g);
  const lsp = textLineSpacing(g, fontSize);
  const lines = splitTextGeometryLines(g);
  let maxW = 0;
  for (const line of lines) maxW = Math.max(maxW, measureTextLineWidth(ctx, g, line));
  const height = lines.length === 0 ? fontSize * 1.25 : (lines.length - 1) * lsp + fontSize * 1.25;
  return { width: maxW, height };
}

/**
 * Draw text at (ox, oy) in current fill style. Uses textAlign left internally; alignment is applied via x offset.
 * Returns the block width and height in the same units as fontSize (typically mm in scene space).
 */
export function fillTextGeometry(
  ctx: CanvasRenderingContext2D,
  g: TextGeometry,
  ox = 0,
  oy = 0,
): { width: number; height: number } {
  const fontSize = applyTextGeometryFont(ctx, g);
  const ls = textLetterSpacing(g, fontSize);
  const ws = textWordSpacingExtra(g, fontSize);
  const layout = layoutTextGeometry(g, ch => ctx.measureText(ch).width);

  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  for (const layoutLine of layout.lines) {
    const line = layoutLine.text;
    const y = oy + layoutLine.y;
    const startX = ox + layoutLine.x;
    if (Math.abs(ls) < 1e-9 && Math.abs(ws) < 1e-9) {
      ctx.fillText(line, startX, y);
    } else {
      let x = startX;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        ctx.fillText(ch, x, y);
        x += ctx.measureText(ch).width + ls;
        if (ch === ' ') x += ws;
      }
    }
  }

  return { width: layout.blockWidth, height: layout.blockHeight };
}
