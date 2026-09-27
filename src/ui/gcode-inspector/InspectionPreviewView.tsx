// The Inspector's picture while its worker reads a big program (ADR-485): the
// moves read so far, growing, under a line saying how far through the file the
// worker is. The full view replaces it once the program is ready. Without
// WebGL the line alone still shows.

import { useEffect, useRef, useState, type RefObject } from 'react';
// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import { createPreviewScene, type PreviewScene } from '../viewer3d/preview-scene';
import type { InspectionPreview } from './inspection-preview';
import './inspector-viewer.css';

export function InspectionPreviewView(props: {
  readonly preview: InspectionPreview;
  readonly label: string;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scene = usePreviewScene(canvasRef);
  const addedRef = useRef(0);
  const { preview } = props;

  useEffect(() => {
    if (scene === null) return;
    for (const chunk of preview.chunks.slice(addedRef.current)) scene.add(chunk);
    addedRef.current = preview.chunks.length;
  }, [preview, scene]);

  return (
    <div className="gcode-viewer-preview">
      <canvas ref={canvasRef} className="gcode-viewer-canvas" aria-hidden="true" />
      <div className="gcode-viewer-hud" role="status">
        <span className="gcode-viewer-hud-status">
          <span className="gcode-viewer-hud-dot" data-live="true" />
          <span className="gcode-viewer-hud-title">{props.label}</span>
        </span>
        <span className="gcode-viewer-hud-detail">
          {preview.moves.toLocaleString('en-US')} moves read · {Math.round(preview.fraction * 100)}%
          of the file
        </span>
        <progress
          className="gcode-viewer-preview-progress"
          value={preview.fraction}
          max={1}
          aria-label="Read so far"
        />
      </div>
    </div>
  );
}

// One scene for the canvas's life, sized to the canvas as it changes.
function usePreviewScene(canvasRef: RefObject<HTMLCanvasElement>): PreviewScene | null {
  const [scene, setScene] = useState<PreviewScene | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    let disposed = false;
    let created: PreviewScene | null = null;
    let observer: ResizeObserver | null = null;
    void createPreviewScene(canvas).then(
      (next) => {
        if (next === null) return;
        if (disposed) {
          next.dispose();
          return;
        }
        created = next;
        const fit = (): void => next.resize(canvas.clientWidth, canvas.clientHeight);
        fit();
        observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
        observer?.observe(canvas);
        setScene(next);
      },
      () => undefined,
    );
    return () => {
      disposed = true;
      observer?.disconnect();
      created?.dispose();
    };
  }, [canvasRef]);
  return scene;
}
