import type { PointerEvent as ReactPointerEvent } from 'react';
import { store, type View } from '../core/store';
import type { Box, Point } from '../core/scene';
import { clampScale } from './canvas-view';
import type { Gesture } from './canvas-gesture-types';

export const DRAG_START_PX = 6;

/** Local preview only. The pointer release is the sole transform commit. */
export function updateGesture(
  g: Gesture,
  point: Point,
  event: ReactPointerEvent<HTMLDivElement>,
  context: {
    editable: boolean;
    scale: number;
    pointers: Map<number, Point>;
    rect: DOMRect | undefined;
    setView: (view: View) => void;
    setMarquee: (box: Box) => void;
  },
): void {
  const { editable, scale, pointers, rect, setView, setMarquee } = context;
  switch (g.kind) {
    case 'pan':
      setView({
        ...g.view,
        x: g.view.x - (event.clientX - g.start.x) / g.view.scale,
        y: g.view.y - (event.clientY - g.start.y) / g.view.scale,
      });
      break;
    case 'pinch': {
      const a = pointers.get(g.ids[0]);
      const b = pointers.get(g.ids[1]);
      if (a === undefined || b === undefined) return;
      const left = rect?.left ?? 0;
      const top = rect?.top ?? 0;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const next = clampScale(
        (g.view.scale * Math.hypot(a.x - b.x, a.y - b.y)) / Math.max(1, g.distance),
      );
      const anchor = {
        x: g.view.x + (g.mid.x - left) / g.view.scale,
        y: g.view.y + (g.mid.y - top) / g.view.scale,
      };
      setView({
        scale: next,
        x: anchor.x - (mid.x - left) / next,
        y: anchor.y - (mid.y - top) / next,
      });
      break;
    }
    case 'move': {
      if (!editable) return;
      const dx = point.x - g.start.x;
      const dy = point.y - g.start.y;
      if (!g.moved && Math.hypot(dx, dy) * scale < DRAG_START_PX) return;
      g.moved = true;
      store.set({ preview: { kind: 'move', ids: g.ids, dx, dy } });
      break;
    }
    case 'scale': {
      const w = Math.max(1e-6, g.from.maxX - g.from.minX);
      const h = Math.max(1e-6, g.from.maxY - g.from.minY);
      const factor = Math.max(
        0.02,
        Math.max(((point.x - g.anchor.x) * g.sign.x) / w, ((point.y - g.anchor.y) * g.sign.y) / h),
      );
      store.set({
        preview: {
          kind: 'scale',
          ids: g.ids,
          ox: g.anchor.x,
          oy: g.anchor.y,
          sx: factor,
          sy: factor,
        },
      });
      break;
    }
    case 'rotate': {
      let angle =
        ((Math.atan2(point.y - g.center.y, point.x - g.center.x) - g.startAngle) * 180) / Math.PI;
      if (event.shiftKey || Math.abs(angle % 15) < 2.5 || Math.abs(angle % 15) > 12.5)
        angle = Math.round(angle / 15) * 15;
      store.set({ preview: { kind: 'rotate', ids: g.ids, cx: g.center.x, cy: g.center.y, angle } });
      break;
    }
    case 'box':
      store.set({
        draft: {
          kind: g.shape,
          x: Math.min(g.start.x, point.x),
          y: Math.min(g.start.y, point.y),
          width: Math.abs(point.x - g.start.x),
          height: Math.abs(point.y - g.start.y),
        },
      });
      break;
    case 'pen':
      g.points.push(point);
      store.set({ draft: { kind: 'pen', points: [...g.points] } });
      break;
    case 'marquee':
      g.current = point;
      if (!g.moved && Math.hypot(point.x - g.start.x, point.y - g.start.y) * scale < DRAG_START_PX)
        return;
      g.moved = true;
      setMarquee({
        minX: Math.min(g.start.x, point.x),
        minY: Math.min(g.start.y, point.y),
        maxX: Math.max(g.start.x, point.x),
        maxY: Math.max(g.start.y, point.y),
      });
      break;
    case 'tap':
      break;
  }
}
