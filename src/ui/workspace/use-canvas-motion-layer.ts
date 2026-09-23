import { useLayoutEffect, useMemo } from 'react';
import type { Project } from '../../core/scene';
import { useStore } from '../state/store';
import { canvasStartLabelObstacles } from './canvas-motion-label-obstacles';
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
  const selectedId = useStore((state) => state.selectedObjectId);
  const additionalSelectedIds = useStore((state) => state.additionalSelectedIds);
  const view = useMemo(
    () =>
      computeView(
        args.canvasSize.width,
        args.canvasSize.height,
        args.project.device.bedWidth,
        args.project.device.bedHeight,
        args.viewState,
      ),
    [args.canvasSize, args.project.device.bedWidth, args.project.device.bedHeight, args.viewState],
  );
  const markersVisible = args.overlay !== null && args.overlay.showStartMarkers !== false;
  const artwork = useMemo(
    () =>
      markersVisible
        ? canvasStartLabelObstacles(args.project.scene, view, selectedId, additionalSelectedIds)
        : [],
    [markersVisible, args.project.scene, view, selectedId, additionalSelectedIds],
  );
  useLayoutEffect(() => {
    const canvas = args.ref.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (args.overlay === null) return;
    drawCanvasMotionOverlay(ctx, args.overlay, view, args.canvasSize, artwork);
  }, [args.ref, view, artwork, args.canvasSize, args.overlay]);
}
