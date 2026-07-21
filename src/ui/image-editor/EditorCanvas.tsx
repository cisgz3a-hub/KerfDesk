// The Image Studio document canvas (ADR-242): on-change redraw of the
// working buffer + selection ants + drag preview, sized to its container,
// cursor-anchored wheel zoom, middle-drag pan.

import { useEffect, useMemo, useRef, useState } from 'react';
import { docToCanvas, drawEditorScene, fitView } from './editor-canvas-draw';
import { useImageEditorStore } from './image-editor-store';
import type { EditorView } from './image-editor-types';
import { useEditorPointer } from './use-editor-pointer';

const ANTS_TICK_MS = 120;

export function EditorCanvas(): JSX.Element {
  const session = useImageEditorStore((s) => s.session);
  const brush = useImageEditorStore((s) => s.brush);
  const color = useImageEditorStore((s) => s.color);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<EditorView | null>(null);
  const [antsPhase, setAntsPhase] = useState(0);

  const revision = session?.revision ?? -1;
  const doc = session?.doc;
  // The doc canvas rebuilds only when pixels changed (revision bump).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- revision is the doc's change signal
  const docCanvas = useMemo(() => (doc === undefined ? null : docToCanvas(doc)), [doc, revision]);

  // Fit once per session (and on container resize before any user zoom).
  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (host === null || canvas === null || doc === undefined) return;
    const resize = (): void => {
      canvas.width = host.clientWidth;
      canvas.height = host.clientHeight;
      setView((current) =>
        current === null ? fitView(doc.width, doc.height, canvas.width, canvas.height) : current,
      );
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    return () => observer.disconnect();
  }, [doc]);

  // Ants animation ticks only while a selection exists (F-L2).
  const hasSelection = (session?.selection ?? null) !== null;
  useEffect(() => {
    if (!hasSelection) return;
    const timer = window.setInterval(
      () => setAntsPhase((phase) => (phase + 1) % 1000),
      ANTS_TICK_MS,
    );
    return () => window.clearInterval(timer);
  }, [hasSelection]);

  const activeView = view ?? { scale: 1, panX: 0, panY: 0 };
  const pointer = useEditorPointer(activeView, setView);

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
        color: `rgb(${color.r}, ${color.g}, ${color.b})`,
        widthPx: brush.diameterPx,
      },
    );
  });

  return (
    <div ref={hostRef} style={hostStyle}>
      <canvas
        ref={canvasRef}
        style={canvasStyle}
        onPointerDown={pointer.onPointerDown}
        onPointerMove={pointer.onPointerMove}
        onPointerUp={pointer.onPointerUp}
        onPointerCancel={pointer.cancelDrag}
        onWheel={pointer.onWheel}
        aria-label="Image Studio document canvas"
      />
    </div>
  );
}

const hostStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
  background: 'var(--lf-bg-2)',
};

const canvasStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  height: '100%',
  touchAction: 'none',
  cursor: 'crosshair',
};
