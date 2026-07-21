// The Image Studio document canvas (ADR-242): on-change redraw of the
// working buffer + selection ants + drag preview, the live brush cursor
// (use-brush-cursor.ts), and fit/zoom/pan through the store view.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAdjustPreviewDoc } from './adjust-dialog-store';
import {
  docToCanvas,
  drawEditorScene,
  drawQuickMaskOverlay,
  drawTransformPreview,
} from './editor-canvas-draw';
import { useCompositeDoc } from './use-composite-doc';
import { useImageEditorStore } from './image-editor-store';
import { useQuickMaskStore } from './quick-mask-store';
import { BRUSH_CURSOR_STYLE } from './use-brush-cursor';
import { useCanvasFit } from './use-canvas-fit';
import { useCanvasHover } from './use-canvas-hover';
import { useEditorPointer } from './use-editor-pointer';
import { INFO_READOUT_STYLE } from './use-info-readout';
import { MODE_BADGE_STYLE } from './use-mode-badge';

const ANTS_TICK_MS = 120;

export function EditorCanvas(): JSX.Element {
  const session = useImageEditorStore((s) => s.session);
  const brush = useImageEditorStore((s) => s.brush);
  const foreground = useImageEditorStore((s) => s.foreground);
  const tool = useImageEditorStore((s) => s.tool);
  const view = useImageEditorStore((s) => s.view);
  const setView = useImageEditorStore((s) => s.setView);
  const isSpacePanning = useImageEditorStore((s) => s.isSpacePanning);
  const pendingCrop = useImageEditorStore((s) => s.pendingCrop);
  const transform = useImageEditorStore((s) => s.transform);
  const rubylith = useQuickMaskStore((s) => s.rubylith);
  useQuickMaskStore((s) => s.revision);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [antsPhase, setAntsPhase] = useState(0);

  const revision = session?.revision ?? -1;
  // The canvas shows the layer composite (identity for single-layer
  // sessions); an enabled adjustment preview substitutes for it.
  const adjustPreview = useAdjustPreviewDoc();
  const composite = useCompositeDoc(session, revision);
  const doc = adjustPreview ?? composite;
  // The doc canvas rebuilds only when pixels changed (revision bump or a
  // fresh preview buffer identity).
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
  const hover = useCanvasHover(hostRef, tool, brush, activeView, isSpacePanning);

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
      pendingCrop,
    );
    if (rubylith !== null) drawQuickMaskOverlay(ctx, activeView, rubylith);
    if (transform !== null) {
      drawTransformPreview(ctx, activeView, {
        rect: transform.floating.rect,
        pixels: transform.floating.pixels,
        alpha: transform.floating.alpha,
        affine: transform.affine,
      });
    }
  });

  return (
    <div ref={hostRef} style={hostStyle}>
      <canvas
        ref={canvasRef}
        style={{ ...canvasStyle, cursor: hover.canvasCursor }}
        onPointerDown={pointer.onPointerDown}
        onPointerMove={(e) => {
          hover.onHoverMove(e);
          pointer.onPointerMove(e);
        }}
        onPointerUp={pointer.onPointerUp}
        onPointerCancel={pointer.cancelDrag}
        onPointerLeave={hover.onHoverLeave}
        onWheel={pointer.onWheel}
        aria-label="Image Studio document canvas"
      />
      <div ref={hover.cursorRef} style={BRUSH_CURSOR_STYLE} aria-hidden="true" />
      <div ref={hover.badgeRef} style={MODE_BADGE_STYLE} aria-hidden="true" />
      <div ref={hover.infoRef} style={INFO_READOUT_STYLE} aria-hidden="true" />
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
