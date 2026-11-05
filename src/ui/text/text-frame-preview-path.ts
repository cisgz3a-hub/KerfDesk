// The text frame preview's outline path (perf audit S7-P3-2). Display only:
// the committed text and its burn are untouched.

import type { Polyline, Vec2 } from '../../core/scene';
import type { TextRenderResult } from '../../core/text';

export type TextFramePreviewGeometry = {
  readonly minX: number;
  readonly width: number;
  readonly height: number;
  readonly paths: string;
};

export function textFramePreviewGeometry(
  preview: TextRenderResult,
  layout: NonNullable<TextRenderResult['textBoxLayout']>,
): TextFramePreviewGeometry {
  const minX = Math.min(0, preview.bounds.minX);
  const width = Math.max(layout.widthMm, preview.bounds.maxX, 1) - minX;
  const height = Math.max(layout.heightMm, preview.bounds.maxY, 1);
  // The preview is 130 px tall, so points closer than a thousandth of the frame
  // to the last one drawn add nothing visible: 2,000 characters of Roboto are
  // about 250,000 points.
  const step = Math.max(width, height) / PREVIEW_STEPS;
  const paths = preview.paths
    .flatMap((path) => path.polylines)
    .map((line) => previewPolyline(line, step))
    .join(' ');
  return { minX, width, height, paths };
}

const PREVIEW_STEPS = 1000;

function previewPolyline(line: Polyline, step: number): string {
  const parts: string[] = [];
  let drawn: Vec2 | null = null;
  line.points.forEach((point, index) => {
    const last = index === line.points.length - 1;
    if (drawn !== null && !last && Math.hypot(point.x - drawn.x, point.y - drawn.y) < step) return;
    parts.push(`${drawn === null ? 'M' : 'L'}${point.x} ${point.y}`);
    drawn = point;
  });
  return parts.join(' ') + (line.closed ? ' Z' : '');
}
