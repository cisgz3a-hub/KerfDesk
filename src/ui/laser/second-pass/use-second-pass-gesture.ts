import { useRef, useState, type PointerEvent } from 'react';
import { toMachineCoords } from '../../../core/devices';
import type { LaserSecondPassStroke } from '../../../core/laser-second-pass';
import type { SecondPassCanvasProps } from './SecondPassCanvas';
import type { CanvasView, SecondPassViewport } from './second-pass-canvas-view';

export function useSecondPassGesture(props: SecondPassCanvasProps, viewport: SecondPassViewport) {
  const gesture = useRef<{
    pointer: number;
    start: { x: number; y: number };
    view: CanvasView;
    stroke: LaserSecondPassStroke | null;
  } | null>(null);
  const [draft, setDraft] = useState<LaserSecondPassStroke | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const point = (event: { clientX: number; clientY: number }) =>
    canvasPoint(event, viewport.host.current);
  const workPoint = (p: { x: number; y: number }) =>
    toMachineCoords(
      {
        x: (p.x - viewport.view.x) / viewport.view.scale,
        y: (p.y - viewport.view.y) / viewport.view.scale,
      },
      props.device,
    );
  const begin = (event: PointerEvent<HTMLDivElement>): void => {
    if (props.disabled || gesture.current || (event.button !== 0 && event.button !== 1)) return;
    const start = point(event);
    const pan = props.tool === 'pan' || event.button === 1 || event.altKey || props.showPreview;
    const stroke: LaserSecondPassStroke | null = pan
      ? null
      : {
          id: crypto.randomUUID(),
          mode: props.tool === 'erase' ? 'erase' : 'paint',
          radiusMm: props.radiusMm,
          powerScale: props.powerScale,
          points: [workPoint(start)],
        };
    gesture.current = { pointer: event.pointerId, start, view: viewport.view, stroke };
    viewport.active.current = true;
    setDraft(stroke);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const move = (event: PointerEvent<HTMLDivElement>): void => {
    const p = point(event);
    setCursor(p);
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;
    if (!active.stroke) {
      viewport.setView({
        ...active.view,
        x: active.view.x + p.x - active.start.x,
        y: active.view.y + p.y - active.start.y,
      });
      return;
    }
    const next = workPoint(p);
    const last = active.stroke.points.at(-1);
    if (last && Math.hypot(next.x - last.x, next.y - last.y) < Math.min(0.05, props.radiusMm / 8))
      return;
    active.stroke = { ...active.stroke, points: [...active.stroke.points, next] };
    setDraft(active.stroke);
  };
  const cancel = (): void => {
    gesture.current = null;
    viewport.active.current = false;
    setDraft(null);
  };
  const finish = (event: PointerEvent<HTMLDivElement>): void => {
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;
    cancel();
    if (active.stroke) {
      const end = workPoint(point(event));
      const last = active.stroke.points.at(-1);
      props.onStroke(
        last?.x === end.x && last.y === end.y
          ? active.stroke
          : { ...active.stroke, points: [...active.stroke.points, end] },
      );
    }
  };
  return { draft, cursor, begin, move, finish, cancel, leave: () => setCursor(null) };
}

function canvasPoint(event: { clientX: number; clientY: number }, host: HTMLDivElement | null) {
  const rect = host?.getBoundingClientRect();
  return {
    x: event.clientX - (rect?.left ?? 0) - (host?.clientLeft ?? 0),
    y: event.clientY - (rect?.top ?? 0) - (host?.clientTop ?? 0),
  };
}
