/**
 * Convert text to vector path outlines using canvas + bitmap tracing.
 * Renders text to a high-res bitmap, then traces it (same stack as image import).
 *
 * Limitation: Canvas doesn't expose glyph outlines directly.
 * We render text to a high-res canvas and trace the result (imagetracerjs).
 */

import { getPaths, traceCanvas } from '../import/trace/ImageTracerAdapter';
import type { SubPath, PathSegment, TextGeometry } from '../core/scene/SceneObject';
import { fillTextGeometry, measureTextGeometrySize } from './textCanvasDraw';
import { findBundledFont } from '../fonts/fontRegistry';
import { loadFont } from '../fonts/loadFont';
import { textToPathOpentype } from '../fonts/textToPathOpentype';
import { textToPathHershey } from '../fonts/textToPathHershey';

export interface TextPathResult {
  subPaths: SubPath[];
  width: number;
  height: number;
}

interface PotraceItem {
  type: string;
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

/** Collapse anti-aliased glyph edges so potrace follows a thinner stroke. */
function hardThresholdInk(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const darkness = 255 - lum;
    // Threshold 220: only count clearly-dark pixels as ink.
    // Lower values (like 170) include anti-aliased gray fringe pixels,
    // which makes traced outlines fatter than the true glyph edge.
    const ink = darkness > 220 ? 0 : 255;
    d[i] = ink;
    d[i + 1] = ink;
    d[i + 2] = ink;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function contourToSubPath(
  items: PotraceItem[],
  invScale: number,
  ox: number,
  oy: number,
): SubPath | null {
  if (items.length < 2) return null;
  const segments: PathSegment[] = [];
  const first = items[0];
  if (first.type !== 'POINT' || first.x === undefined || first.y === undefined) return null;

  segments.push({
    type: 'move',
    to: { x: first.x * invScale - ox, y: first.y * invScale - oy },
  });

  for (let i = 1; i < items.length; i++) {
    const it = items[i];
    if (it.type === 'CURVE') {
      if (
        it.x1 == null || it.y1 == null || it.x2 == null || it.y2 == null ||
        it.x == null || it.y == null
      ) continue;
      segments.push({
        type: 'cubic',
        cp1: { x: it.x1 * invScale - ox, y: it.y1 * invScale - oy },
        cp2: { x: it.x2 * invScale - ox, y: it.y2 * invScale - oy },
        to: { x: it.x * invScale - ox, y: it.y * invScale - oy },
      });
    } else if (it.type === 'POINT' && it.x != null && it.y != null) {
      segments.push({
        type: 'line',
        to: { x: it.x * invScale - ox, y: it.y * invScale - oy },
      });
    }
  }

  segments.push({ type: 'close' });
  return { segments, closed: true };
}

/**
 * Render TextGeometry to a canvas, then trace it to vector outlines.
 */
export async function textGeometryToPath(g: TextGeometry): Promise<TextPathResult | null> {
  const text = g.text || '';
  if (!text.trim()) return null;

  // Bundled-font path currently ignores spacing/alignment/line-break/style toggles.
  // Unknown fonts continue through the existing canvas-trace implementation below.
  const bundled = findBundledFont(g.fontFamily);
  if (bundled?.hersheyFamily) {
    try {
      const raw = textToPathHershey(g, bundled.hersheyFamily);
      if (raw.length === 0) return null;
      return normalizeToTopLeft(raw);
    } catch (e) {
      console.warn(`[TextToPath] Hershey font '${g.fontFamily}' failed, falling back to canvas:`, e);
      // Fall through to fallback paths.
    }
  }
  if (bundled) {
    try {
      const font = await loadFont(bundled.url);
      const raw = textToPathOpentype(g, font);
      if (raw.length === 0) return null;
      return normalizeToTopLeft(raw);
    } catch (e) {
      console.warn(`[TextToPath] Bundled font '${g.fontFamily}' failed, falling back to canvas:`, e);
      // Fall through to canvas path.
    }
  }

  const scale = 8;
  const baseSize = g.fontSize || 10;
  const gScaled: TextGeometry = {
    ...g,
    type: 'text',
    fontSize: baseSize * scale,
  };

  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  if (!measureCtx) return null;

  const { width: wPx, height: hPx } = measureTextGeometrySize(measureCtx, gScaled);
  const padding = baseSize * scale * 0.2;
  const canvasW = Math.max(1, Math.ceil(wPx + padding * 2));
  const canvasH = Math.max(1, Math.ceil(hPx + padding * 2));

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvasW, canvasH);

  ctx.fillStyle = 'black';
  fillTextGeometry(ctx, gScaled, padding, padding);
  hardThresholdInk(ctx, canvasW, canvasH);

  try {
    const pathList = traceCanvas(canvas, {
      turdsize: 1,
      alphamax: 1.0,
      opttolerance: 0.2,
      optcurve: true,
      turnpolicy: 'minority',
    });

    const rawPaths = getPaths(pathList) as PotraceItem[][];
    const invScale = 1 / scale;
    const ox = padding * invScale;
    const oy = padding * invScale;

    const subPaths: SubPath[] = [];
    for (const items of rawPaths) {
      const sp = contourToSubPath(items, invScale, ox, oy);
      if (sp) subPaths.push(sp);
    }

    if (subPaths.length === 0) return null;

    return {
      subPaths,
      width: wPx / scale,
      height: hPx / scale,
    };
  } catch (e) {
    console.error('Text to path failed:', e);
    return null;
  }
}

function normalizeToTopLeft(subPaths: SubPath[]): TextPathResult {
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;

  const visit = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };

  for (const sp of subPaths) {
    for (const seg of sp.segments) {
      if (seg.type === 'close') continue;
      visit(seg.to.x, seg.to.y);
      if (seg.type === 'cubic') {
        visit(seg.cp1.x, seg.cp1.y);
        visit(seg.cp2.x, seg.cp2.y);
      } else if (seg.type === 'quadratic') {
        visit(seg.cp.x, seg.cp.y);
      }
    }
  }

  if (!Number.isFinite(minX)) return { subPaths, width: 0, height: 0 };

  const dx = -minX;
  const dy = -minY;
  for (const sp of subPaths) {
    for (const seg of sp.segments) {
      if (seg.type === 'close') continue;
      seg.to.x += dx; seg.to.y += dy;
      if (seg.type === 'cubic') {
        seg.cp1.x += dx; seg.cp1.y += dy;
        seg.cp2.x += dx; seg.cp2.y += dy;
      } else if (seg.type === 'quadratic') {
        seg.cp.x += dx; seg.cp.y += dy;
      }
    }
  }

  return { subPaths, width: maxX - minX, height: maxY - minY };
}

/**
 * @deprecated Prefer textGeometryToPath with full TextGeometry for spacing/align.
 */
export async function textToPath(
  text: string,
  fontFamily: string = 'Arial',
  fontSize: number = 20,
  bold: boolean = false,
  italic: boolean = false,
): Promise<TextPathResult | null> {
  return textGeometryToPath({
    type: 'text',
    text,
    fontFamily,
    fontSize,
    bold,
    italic,
  });
}
