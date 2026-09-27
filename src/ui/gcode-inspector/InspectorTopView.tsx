// The program seen from above, where the 3D view cannot show it (ADR-485,
// top-view-image.ts). Which move each pixel shows is worked out for the
// viewport's size, again when it changes size, and a lens change repaints.

import { useEffect, useRef, useState } from 'react';
import { resolveViewer3dTheme } from '../viewer3d';
import type { InspectorRenderModel } from './inspector-model';
import { paintTopView, topViewGrid, type TopViewGrid } from './top-view-image';

export type TopViewSource = {
  readonly model: InspectorRenderModel;
  /** The chosen lens's colour for each move, as the 3D view is given it. */
  readonly colorOf: (segmentIndex: number) => readonly [number, number, number];
};

export function InspectorTopView(props: TopViewSource & { readonly reason: string }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const grid = useTopViewGrid(canvasRef, props.model);
  const { colorOf } = props;
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = grid === null ? null : (canvas?.getContext('2d') ?? null);
    if (grid === null || canvas === null || context === null) return;
    canvas.width = grid.width;
    canvas.height = grid.height;
    const pixels = paintTopView(grid, colorOf, resolveViewer3dTheme(canvas).background);
    context.putImageData(new ImageData(pixels, grid.width, grid.height), 0, 0);
  }, [grid, colorOf]);
  return (
    <>
      <canvas
        ref={canvasRef}
        className="gcode-viewer-top-view"
        role="img"
        aria-label="G-code toolpath from above"
      />
      <p className="gcode-viewer-message gcode-viewer-message--below">
        3D view unavailable: {props.reason} Showing the moves from above; where moves cross, the
        deepest shows. The program parsed — readouts are live.
      </p>
    </>
  );
}

function useTopViewGrid(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  model: InspectorRenderModel,
): TopViewGrid | null {
  const [grid, setGrid] = useState<TopViewGrid | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const measure = (): void => {
      const scale = window.devicePixelRatio || 1;
      const size = { width: canvas.clientWidth * scale, height: canvas.clientHeight * scale };
      setGrid(topViewGrid(model, size));
    };
    // The observer's first call measures it; without one, measure it once.
    if (typeof ResizeObserver === 'undefined') {
      measure();
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvasRef, model]);
  return grid;
}
