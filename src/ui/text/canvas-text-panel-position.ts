import type { CSSProperties } from 'react';
import type { CanvasBitmapSize } from '../workspace/use-canvas-bitmap-size';

/** Keep the typing area reachable even when both side rails narrow the canvas. */
export function canvasTextPanelPosition(
  input: CSSProperties,
  size: CanvasBitmapSize,
): CSSProperties {
  const rect = inputRectangle(input);
  const width = Math.min(338, Math.max(0, size.width - 24));
  const rightX = size.width - width - 12;
  if (rect.right + 16 < rightX) return { right: 12 };
  if (rect.left - 16 > width + 12) return { left: 12 };
  const below = size.height - 76 - rect.bottom - 16;
  const above = rect.top - 28;
  if (above > below && above >= 200) {
    return { right: 12, top: 12, maxHeight: above };
  }
  const top = Math.max(12, Math.min(rect.bottom + 16, size.height - 220));
  return { right: 12, top, maxHeight: Math.max(144, size.height - 76 - top) };
}

function inputRectangle(style: CSSProperties) {
  const x = numeric(style.left);
  const y = numeric(style.top);
  const width = numeric(style.width);
  const height = numeric(style.height);
  const matrix =
    typeof style.transform === 'string' && style.transform.startsWith('matrix(')
      ? style.transform.slice(7, -1).split(',').map(Number)
      : [1, 0, 0, 1];
  const corners = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ].map(([cx = 0, cy = 0]) => ({
    x: x + cx * (matrix[0] ?? 1) + cy * (matrix[2] ?? 0),
    y: y + cx * (matrix[1] ?? 0) + cy * (matrix[3] ?? 1),
  }));
  return {
    left: Math.min(...corners.map((point) => point.x)),
    right: Math.max(...corners.map((point) => point.x)),
    top: Math.min(...corners.map((point) => point.y)),
    bottom: Math.max(...corners.map((point) => point.y)),
  };
}

function numeric(value: CSSProperties['left']): number {
  return typeof value === 'number' ? value : 0;
}
