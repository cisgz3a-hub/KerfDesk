/**
 * Convert text to vector path outlines using canvas + potrace-js tracing.
 * Renders text to a high-res bitmap, then traces it (same stack as image import).
 *
 * Limitation: Canvas doesn't expose glyph outlines directly.
 * We render text to a high-res canvas and trace the result with potrace-js.
 */

import { getPaths, traceCanvas } from 'potrace-js';
import type { SubPath, PathSegment, TextGeometry } from '../core/scene/SceneObject';
import { fillTextGeometry, measureTextGeometrySize } from './textCanvasDraw';

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

  const scale = 4;
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

  try {
    const pathList = traceCanvas(canvas, {
      turdsize: 2,
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
