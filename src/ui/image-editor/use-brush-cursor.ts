// The live circle brush cursor (Photoshop convention): a DOM element sized to
// the exact brush diameter at the current zoom, positioned directly from
// pointer events so mouse moves never re-render React. Caps Lock switches to
// the precision crosshair; tiny circles fall back to the crosshair too.

import { useEffect, useRef } from 'react';
import type { BrushSettings, EditorTool } from './editor-session';
import type { EditorView } from './image-editor-types';

const MIN_CURSOR_CIRCLE_PX = 4;

type BrushCursor = {
  readonly cursorRef: React.RefObject<HTMLDivElement>;
  readonly moveCursor: (e: React.PointerEvent<HTMLElement>, host: HTMLElement | null) => void;
  readonly hideCursor: () => void;
  /** CSS cursor for the canvas under the circle. */
  readonly canvasCursor: string;
};

export function useBrushCursor(
  tool: EditorTool,
  brush: BrushSettings,
  view: EditorView,
  isSpacePanning: boolean,
): BrushCursor {
  const cursorRef = useRef<HTMLDivElement>(null);
  const isPaintTool =
    tool.kind === 'brush' ||
    tool.kind === 'pencil' ||
    tool.kind === 'eraser' ||
    tool.kind === 'line';
  const circlePx = brush.diameterPx * view.scale;
  const showCircle = isPaintTool && !isSpacePanning && circlePx >= MIN_CURSOR_CIRCLE_PX;

  // Keep the circle's size in sync outside pointer moves ([ ] keys, zoom);
  // position updates live in moveCursor.
  useEffect(() => {
    const cursor = cursorRef.current;
    if (cursor === null) return;
    cursor.style.width = `${circlePx}px`;
    cursor.style.height = `${circlePx}px`;
    if (!showCircle) cursor.style.display = 'none';
  }, [circlePx, showCircle]);

  const moveCursor = (e: React.PointerEvent<HTMLElement>, host: HTMLElement | null): void => {
    const cursor = cursorRef.current;
    if (cursor === null || host === null) return;
    if (!showCircle || e.getModifierState('CapsLock')) {
      cursor.style.display = 'none';
      return;
    }
    cursor.style.display = 'block';
    const rect = host.getBoundingClientRect();
    const x = e.clientX - rect.left - circlePx / 2;
    const y = e.clientY - rect.top - circlePx / 2;
    cursor.style.transform = `translate(${x}px, ${y}px)`;
  };

  const hideCursor = (): void => {
    const cursor = cursorRef.current;
    if (cursor !== null) cursor.style.display = 'none';
  };

  const canvasCursor = isSpacePanning ? 'grab' : showCircle ? 'none' : 'crosshair';
  return { cursorRef, moveCursor, hideCursor, canvasCursor };
}

// Two-tone ring (light stroke + dark shadow) stays visible over any pixels.
// Canvas-cursor chrome, not themable UI: the ring must contrast with image
// pixels, not with the app theme, so the literals are deliberate.
/* eslint-disable no-restricted-syntax */
export const BRUSH_CURSOR_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  display: 'none',
  pointerEvents: 'none',
  borderRadius: '50%',
  border: '1px solid rgba(255, 255, 255, 0.9)',
  boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.8) inset, 0 0 0 1px rgba(0, 0, 0, 0.35)',
};
/* eslint-enable no-restricted-syntax */
