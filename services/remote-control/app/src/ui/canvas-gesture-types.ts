import type { Box, Point } from '../core/scene';
import type { View } from '../core/store';

export type Gesture =
  | { kind: 'pan'; start: Point; view: View }
  | { kind: 'pinch'; ids: [number, number]; distance: number; mid: Point; view: View }
  | { kind: 'move'; ids: string[]; tapped: string[]; start: Point; moved: boolean }
  | { kind: 'scale'; ids: string[]; from: Box; anchor: Point; sign: Point }
  | { kind: 'rotate'; ids: string[]; center: Point; startAngle: number }
  | { kind: 'box'; shape: 'rect' | 'ellipse'; start: Point }
  | { kind: 'pen'; points: Point[] }
  | {
      kind: 'marquee';
      start: Point;
      current: Point;
      moved: boolean;
      add: boolean;
      selected: string[];
    }
  | { kind: 'tap'; at: Point };

export function handleAt(
  point: Point,
  box: Box | null,
  ids: string[],
  scale: number,
): Gesture | null {
  if (box === null) return null;
  const sidePx = Math.min(box.maxX - box.minX, box.maxY - box.minY) * scale;
  const radius = Math.min(24, Math.max(10, sidePx / 3)) / scale;
  const corners: [Point, Point][] = [
    [
      { x: box.minX, y: box.minY },
      { x: box.maxX, y: box.maxY },
    ],
    [
      { x: box.maxX, y: box.minY },
      { x: box.minX, y: box.maxY },
    ],
    [
      { x: box.maxX, y: box.maxY },
      { x: box.minX, y: box.minY },
    ],
    [
      { x: box.minX, y: box.maxY },
      { x: box.maxX, y: box.minY },
    ],
  ];
  for (const [corner, anchor] of corners)
    if (Math.hypot(point.x - corner.x, point.y - corner.y) <= radius)
      return {
        kind: 'scale',
        ids,
        from: box,
        anchor,
        sign: { x: Math.sign(corner.x - anchor.x) || 1, y: Math.sign(corner.y - anchor.y) || 1 },
      };
  const rotate = { x: (box.minX + box.maxX) / 2, y: box.minY - 30 / scale };
  if (Math.hypot(point.x - rotate.x, point.y - rotate.y) > radius) return null;
  const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  return {
    kind: 'rotate',
    ids,
    center,
    startAngle: Math.atan2(point.y - center.y, point.x - center.x),
  };
}

export const CANCEL_CANVAS_GESTURE = 'kerfdesk:cancel-canvas-gesture';
export function cancelCanvasGesture(): boolean {
  return !window.dispatchEvent(new Event(CANCEL_CANVAS_GESTURE, { cancelable: true }));
}

export function typingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest('input, textarea, select, [role="textbox"]') !== null)
  );
}
