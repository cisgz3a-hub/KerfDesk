/**
 * Canvas text layout for TextGeometry — shared by SceneRenderer, bounds, hit-test, and text-to-path.
 */

import type { TextGeometry } from '../core/scene/SceneObject';

function pctOrDefault(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

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

function letterSpacingPx(g: TextGeometry, fontSize: number): number {
  return (pctOrDefault(g.letterSpacing, 0) / 100) * fontSize;
}

function lineSpacingPx(g: TextGeometry, fontSize: number): number {
  return (pctOrDefault(g.lineSpacing, 120) / 100) * fontSize;
}

function wordSpacingExtraPx(g: TextGeometry, fontSize: number): number {
  return ((pctOrDefault(g.wordSpacing, 100) - 100) / 100) * fontSize * 0.25;
}

/** Pixel width of one line including letter and word spacing. */
export function measureTextLineWidth(ctx: CanvasRenderingContext2D, g: TextGeometry, line: string): number {
  const fontSize = applyTextGeometryFont(ctx, g);
  const ls = letterSpacingPx(g, fontSize);
  const ws = wordSpacingExtraPx(g, fontSize);
  let x = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    x += ctx.measureText(ch).width + ls;
    if (ch === ' ') x += ws;
  }
  return line.length === 0 ? 0 : x - ls;
}

/** Local-space width and height of the full text block. */
export function measureTextGeometrySize(ctx: CanvasRenderingContext2D, g: TextGeometry): { width: number; height: number } {
  const fontSize = applyTextGeometryFont(ctx, g);
  const lsp = lineSpacingPx(g, fontSize);
  const lines = (g.text ?? '').split('\n');
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
  const ls = letterSpacingPx(g, fontSize);
  const lsp = lineSpacingPx(g, fontSize);
  const ws = wordSpacingExtraPx(g, fontSize);
  const lines = (g.text ?? '').split('\n');
  const align = g.textAlign || 'left';

  let blockW = 0;
  for (const line of lines) blockW = Math.max(blockW, measureTextLineWidth(ctx, g, line));

  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const lineW = measureTextLineWidth(ctx, g, line);
    const y = oy + lineIdx * lsp;
    let startX = ox;
    if (align === 'center') startX = ox + (blockW - lineW) / 2;
    else if (align === 'right') startX = ox + blockW - lineW;

    let x = startX;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      ctx.fillText(ch, x, y);
      x += ctx.measureText(ch).width + ls;
      if (ch === ' ') x += ws;
    }
  }

  const height = lines.length === 0 ? fontSize * 1.25 : (lines.length - 1) * lsp + fontSize * 1.25;
  return { width: blockW, height };
}
