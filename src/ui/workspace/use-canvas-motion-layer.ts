import { useLayoutEffect, useRef } from 'react';
import type { Project } from '../../core/scene';
import { drawCanvasMotionOverlay, type CanvasMotionOverlay } from './draw-canvas-motion';
import { isMeasuredCanvasBitmapSize, type CanvasBitmapSize } from './use-canvas-bitmap-size';
import { computeView, type ViewState } from './view-transform';

type MotionLayerArgs = {
  readonly ref: React.RefObject<HTMLCanvasElement | null>;
  readonly project: Project;
  readonly viewState: ViewState;
  readonly canvasSize: CanvasBitmapSize;
  readonly overlay: CanvasMotionOverlay | null;
};

export function useCanvasMotionLayer(args: MotionLayerArgs): void {
  // The route raster asks for a repaint after a zoom has settled or a sliced
  // rebuild lands; it must paint the latest committed props, not the ones in
  // force when the request was made, and it must not re-render React.
  const latest = useRef(args);
  useLayoutEffect(() => {
    latest.current = args;
  });
  useLayoutEffect(() => {
    const paint = (): void => paintMotionLayer(latest.current, paint);
    paint();
  }, [
    args.ref,
    args.project.device.bedWidth,
    args.project.device.bedHeight,
    args.viewState,
    args.canvasSize,
    args.overlay,
  ]);
}

function paintMotionLayer(args: MotionLayerArgs, requestRedraw: () => void): void {
  const canvas = args.ref.current;
  if (canvas === null) return;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // The placeholder bitmap is replaced within the same commit; painting the
  // route into it would build a raster only to throw it away.
  if (args.overlay === null || !isMeasuredCanvasBitmapSize(args.canvasSize)) return;
  const view = computeView(
    canvas.width,
    canvas.height,
    args.project.device.bedWidth,
    args.project.device.bedHeight,
    args.viewState,
  );
  drawCanvasMotionOverlay(ctx, args.overlay, view, requestRedraw);
}
