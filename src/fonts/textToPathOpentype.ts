import { type Font } from 'opentype.js';
import type { SubPath, TextGeometry } from '../core/scene/SceneObject';

/**
 * Convert a TextGeometry to SubPath[] using real glyph outlines via opentype.js.
 *
 * Coordinate system: output is in mm, with (0,0) at the text's baseline-left.
 * Y increases downward (matches HTML canvas / LaserForge canvas convention).
 *
 * Positioning relative to TextGeometry anchor is handled by the caller
 * (expandTextForCompile / TextToPath dispatcher) — this function just returns
 * the raw glyph outlines.
 */
export function textToPathOpentype(geometry: TextGeometry, font: Font): SubPath[] {
  const { text, fontSize } = geometry;
  if (!text || fontSize <= 0) return [];

  const path = font.getPath(text, 0, 0, fontSize);
  const subPaths: SubPath[] = [];
  let current: SubPath | null = null;

  for (const cmd of path.commands) {
    if (cmd.type === 'M') {
      if (current) subPaths.push(current);
      current = { segments: [{ type: 'move', to: { x: cmd.x, y: cmd.y } }], closed: false };
    } else if (cmd.type === 'L' && current) {
      current.segments.push({ type: 'line', to: { x: cmd.x, y: cmd.y } });
    } else if (cmd.type === 'Q' && current) {
      current.segments.push({
        type: 'quadratic',
        cp: { x: cmd.x1, y: cmd.y1 },
        to: { x: cmd.x, y: cmd.y },
      });
    } else if (cmd.type === 'C' && current) {
      current.segments.push({
        type: 'cubic',
        cp1: { x: cmd.x1, y: cmd.y1 },
        cp2: { x: cmd.x2, y: cmd.y2 },
        to: { x: cmd.x, y: cmd.y },
      });
    } else if (cmd.type === 'Z' && current) {
      current.segments.push({ type: 'close' });
      current.closed = true;
      subPaths.push(current);
      current = null;
    }
  }
  if (current) subPaths.push(current);

  return subPaths;
}
