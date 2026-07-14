import { useEffect } from 'react';
import type { Project } from '../../core/scene';
import { drawCanvasMotionOverlay, type CanvasMotionOverlay } from './draw-canvas-motion';
import type { CanvasBitmapSize } from './use-canvas-bitmap-size';
import { computeView, type ViewState } from './view-transform';

export function useCanvasMotionLayer(args: {
  readonly ref: React.RefObject<HTMLCanvasElement | null>;
  readonly project: Project;
  readonly viewState: ViewState;
  readonly canvasSize: CanvasBitmapSize;
  readonly overlay: CanvasMotionOverlay | null;
}): void {
  useEffect(() => {
    const canvas = args.ref.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (args.overlay === null) return;
    const view = computeView(
      canvas.width,
      canvas.height,
      args.project.device.bedWidth,
      args.project.device.bedHeight,
      args.viewState,
    );
    drawCanvasMotionOverlay(ctx, args.overlay, view);
  }, [
    args.ref,
    args.project.device.bedWidth,
    args.project.device.bedHeight,
    args.viewState,
    args.canvasSize,
    args.overlay,
  ]);
}
