import { useCallback, useLayoutEffect, useRef, useState } from 'react';

export type FloatingBoardPanelPosition = { readonly x: number; readonly y: number };
type PositionRef = React.MutableRefObject<FloatingBoardPanelPosition | null>;
type MovePanel = (position: FloatingBoardPanelPosition) => void;
type PanelRef = React.RefObject<HTMLElement>;
type Drag = {
  readonly pointer: number;
  readonly x: number;
  readonly y: number;
  readonly origin: FloatingBoardPanelPosition;
};
const INSET = 8;

export function useFloatingBoardPanel(remembered: PositionRef) {
  const panelRef = useRef<HTMLElement>(null);
  const [position, setPosition] = useState(remembered.current ?? { x: INSET, y: INSET });
  const move = useCallback(
    (next: FloatingBoardPanelPosition): void => {
      const panel = panelRef.current;
      if (panel === null) return;
      const bounded = clampToCanvas(next, panel);
      remembered.current = bounded;
      setPosition((previous) =>
        previous.x === bounded.x && previous.y === bounded.y ? previous : bounded,
      );
    },
    [remembered],
  );
  usePanelResizeClamp(panelRef, remembered, move);
  return { panelRef, position, dragHandle: usePanelDragHandle(panelRef, remembered, move) };
}

function usePanelResizeClamp(panelRef: PanelRef, remembered: PositionRef, move: MovePanel): void {
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (panel === null || parent === null || parent === undefined) return;
    const update = (): void => move(remembered.current ?? defaultPosition(panel));
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(panel);
    observer?.observe(parent);
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, [move, panelRef, remembered]);
}

function usePanelDragHandle(panelRef: PanelRef, remembered: PositionRef, move: MovePanel) {
  const drag = useRef<Drag | null>(null);
  const finish = (event: React.PointerEvent<HTMLElement>): void => {
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  return {
    onPointerDown: (event: React.PointerEvent<HTMLElement>): void => {
      if (event.button !== 0 || event.isPrimary === false || drag.current !== null) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture?.(event.pointerId);
      drag.current = {
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        origin: remembered.current ?? { x: INSET, y: INSET },
      };
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>): void => {
      const start = drag.current;
      if (start === null || start.pointer !== event.pointerId) return;
      move({
        x: start.origin.x + event.clientX - start.x,
        y: start.origin.y + event.clientY - start.y,
      });
    },
    onPointerUp: finish,
    onPointerCancel: finish,
    onLostPointerCapture: finish,
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>): void => {
      const panel = panelRef.current;
      if (panel !== null) moveByKeyboard(event, panel, remembered.current, move);
    },
    onKeyUp: (event: React.KeyboardEvent<HTMLElement>): void => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key))
        event.stopPropagation();
    },
  };
}

function moveByKeyboard(
  event: React.KeyboardEvent<HTMLElement>,
  panel: HTMLElement,
  current: FloatingBoardPanelPosition | null,
  move: MovePanel,
): void {
  const directions: Readonly<Record<string, FloatingBoardPanelPosition>> = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
  };
  const direction = directions[event.key];
  if (direction === undefined && event.key !== 'Home') return;
  event.preventDefault();
  event.stopPropagation();
  const origin = current ?? defaultPosition(panel);
  const step = event.shiftKey ? 24 : 8;
  move(
    direction === undefined
      ? defaultPosition(panel)
      : { x: origin.x + direction.x * step, y: origin.y + direction.y * step },
  );
}

function defaultPosition(panel: HTMLElement): FloatingBoardPanelPosition {
  return {
    x: Math.max(
      INSET,
      (panel.parentElement?.clientWidth ?? 0) - panel.getBoundingClientRect().width - INSET,
    ),
    y: INSET,
  };
}

function clampToCanvas(
  position: FloatingBoardPanelPosition,
  panel: HTMLElement,
): FloatingBoardPanelPosition {
  const parent = panel.parentElement;
  if (parent === null || parent.clientWidth === 0 || parent.clientHeight === 0) return position;
  const size = panel.getBoundingClientRect();
  return {
    x: Math.min(
      Math.max(INSET, parent.clientWidth - size.width - INSET),
      Math.max(INSET, position.x),
    ),
    y: Math.min(
      Math.max(INSET, parent.clientHeight - size.height - INSET),
      Math.max(INSET, position.y),
    ),
  };
}
