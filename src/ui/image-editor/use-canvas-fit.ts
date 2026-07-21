// Canvas sizing for the Image Studio (ADR-242): keeps the backing store at
// the host's client size, reports the viewport to the editor store, and
// fits the document whenever the view has been cleared (open / Ctrl+0).

import { useEffect } from 'react';
import type { RgbaBuffer } from '../../core/image-edit';
import { fitView } from './editor-canvas-draw';
import { useImageEditorStore } from './image-editor-store';

export function useCanvasFit(
  hostRef: React.RefObject<HTMLDivElement>,
  canvasRef: React.RefObject<HTMLCanvasElement>,
  doc: RgbaBuffer | undefined,
  needsFit: boolean,
): void {
  const setView = useImageEditorStore((s) => s.setView);
  const setViewportSize = useImageEditorStore((s) => s.setViewportSize);
  // Subscribing keeps the calling component re-rendering (and therefore
  // redrawing) after a genuine viewport resize clears the backing store.
  useImageEditorStore((s) => s.viewportSize);
  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (host === null || canvas === null || doc === undefined) return;
    const resize = (): void => {
      // Assigning canvas.width ALWAYS clears the canvas, and a freshly
      // observed ResizeObserver fires once immediately — skipping the no-op
      // assignment keeps the pixels the draw effect just painted
      // (live-verify find: every adjustment-preview frame re-armed the
      // observer and blanked the canvas after the draw). The fit check
      // still runs so Ctrl+0 refits at an unchanged size.
      if (canvas.width !== host.clientWidth || canvas.height !== host.clientHeight) {
        canvas.width = host.clientWidth;
        canvas.height = host.clientHeight;
        setViewportSize(canvas.width, canvas.height);
      }
      if (useImageEditorStore.getState().view === null) {
        setView(fitView(doc.width, doc.height, canvas.width, canvas.height));
      }
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    return () => observer.disconnect();
  }, [canvasRef, doc, hostRef, needsFit, setView, setViewportSize]);
}
