// The Image Studio document canvas (ADR-242): on-change redraw of the
// working buffer + selection ants + drag preview, the live brush cursor
// (use-brush-cursor.ts), and fit/zoom/pan through the store view.

import { useEffect, useMemo, useRef, useState } from 'react';
import { docToCanvas, drawEditorScene } from './editor-canvas-draw';
import { useImageEditorStore } from './image-editor-store';
import { BRUSH_CURSOR_STYLE, useBrushCursor } from './use-brush-cursor';
import { useCanvasFit } from './use-canvas-fit';
import { useEditorPointer } from './use-editor-pointer';
import { MODE_BADGE_STYLE, useModeBadge } from './use-mode-badge';

const ANTS_TICK_MS = 120;

export function EditorCanvas(): JSX.Element {
  const session = useImageEditorStore((s) => s.session);
  const brush = useImageEditorStore((s) => s.brush);
  const foreground = useImageEditorStore((s) => s.foreground);
  const tool = useImageEditorStore((s) => s.tool);
  const view = useImageEditorStore((s) => s.view);
  const setView = useImageEditorStore((s) => s.setView);
  const isSpacePanning = useImageEditorStore((s) => s.isSpacePanning);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [antsPhase, setAntsPhase] = useState(0);

  const revision = session?.revision ?? -1;
  const doc = session?.doc;
  // The doc canvas rebuilds only when pixels changed (revision bump).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- revision is the doc's change signal
  const docCanvas = useMemo(() => (doc === undefined ? null : docToCanvas(doc)), [doc, revision]);
  useCanvasFit(hostRef, canvasRef, doc, view === null);

  // Ants animation ticks only while a selection exists (F-L2).
  const hasSelection = (session?.selection ?? null) !== null;
  useEffect(() => {
    if (!hasSelection) return;
    const timer = window.setInterval(() => setAntsPhase((p) => (p + 1) % 1000), ANTS_TICK_MS);
    return () => window.clearInterval(timer);
  }, [hasSelection]);

  const activeView = view ?? { scale: 1, panX: 0, panY: 0 };
  const pointer = useEditorPointer(activeView, setView);
  const cursor = useBrushCursor(tool, brush, activeView, isSpacePanning);
  const badge = useModeBadge();

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d') ?? null;
    if (canvas === null || ctx === null || docCanvas === null || session === undefined) return;
    drawEditorScene(
      ctx,
      docCanvas,
      activeView,
      session?.selection ?? null,
      pointer.drag,
      antsPhase,
      {
        color: `rgb(${foreground.r}, ${foreground.g}, ${foreground.b})`,
        widthPx: brush.diameterPx,
      },
    );
  });

  return (
    <div ref={hostRef} style={hostStyle}>
      <canvas
        ref={canvasRef}
        style={{ ...canvasStyle, cursor: cursor.canvasCursor }}
        onPointerDown={pointer.onPointerDown}
        onPointerMove={(e) => {
          cursor.moveCursor(e, hostRef.current);
          badge.updateBadge(e, hostRef.current);
          pointer.onPointerMove(e);
        }}
        onPointerUp={pointer.onPointerUp}
        onPointerCancel={pointer.cancelDrag}
        onPointerLeave={() => {
          cursor.hideCursor();
          badge.hideBadge();
        }}
        onWheel={pointer.onWheel}
        aria-label="Image Studio document canvas"
      />
      <div ref={cursor.cursorRef} style={BRUSH_CURSOR_STYLE} aria-hidden="true" />
      <div ref={badge.badgeRef} style={MODE_BADGE_STYLE} aria-hidden="true" />
    </div>
  );
}

const hostStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
  position: 'relative',
  background: 'var(--lf-bg-2)',
};

const canvasStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  height: '100%',
  touchAction: 'none',
};
