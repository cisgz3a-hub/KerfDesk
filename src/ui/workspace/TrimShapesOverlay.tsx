// The Trim Shapes hover highlight (LBG-T04): the stretch of outline a click
// would delete, drawn on its own pointer-transparent canvas so following the
// pointer never redraws the scene. Its ends are marked where they meet the
// crossing outlines.

import { useLayoutEffect, useMemo, useRef } from 'react';
import type { TrimTarget } from '../../core/geometry/trim-shapes';
import type { Project } from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { canvasTheme } from '../theme/canvas-theme';
import { TRIM_PICK_TOLERANCE_PX, trimHoverTarget } from './trim-shapes-tool';
import type { CanvasBitmapSize } from './use-canvas-bitmap-size';
import { computeView, type ViewState, type ViewTransform } from './view-transform';

const LINE_WIDTH_PX = 3;
const END_RADIUS_PX = 4;

export function TrimShapesOverlay(props: {
  readonly project: Project;
  readonly canvasSize: CanvasBitmapSize;
  readonly viewState: ViewState;
  /** Off in Preview and mid-drag: the pointer belongs to something else then. */
  readonly enabled: boolean;
}): JSX.Element | null {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const active = useUiStore((state) => state.toolMode.kind === 'trim-shapes') && props.enabled;
  const cursor = useStore((state) => state.cursorMm);
  const { width, height } = props.canvasSize;
  const { bedWidth, bedHeight } = props.project.device;
  const view = useMemo(
    () => computeView(width, height, bedWidth, bedHeight, props.viewState),
    [width, height, bedWidth, bedHeight, props.viewState],
  );
  const scene = props.project.scene;
  const target = useMemo(
    () =>
      active && cursor !== null
        ? trimHoverTarget(scene, cursor, TRIM_PICK_TOLERANCE_PX / view.scale)
        : null,
    [active, cursor, scene, view.scale],
  );
  useLayoutEffect(() => {
    const ctx = ref.current?.getContext('2d') ?? null;
    if (ctx === null) return;
    ctx.clearRect(0, 0, width, height);
    if (target !== null) drawTrimTarget(ctx, target, view);
  }, [target, view, width, height]);
  if (!active) return null;
  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      style={layerStyle}
      aria-hidden="true"
      data-testid="trim-shapes-layer"
    />
  );
}

function drawTrimTarget(
  ctx: CanvasRenderingContext2D,
  target: TrimTarget,
  view: ViewTransform,
): void {
  const toCanvas = (point: { readonly x: number; readonly y: number }) => ({
    x: view.offsetX + point.x * view.scale,
    y: view.offsetY + point.y * view.scale,
  });
  ctx.save();
  ctx.strokeStyle = canvasTheme.trimHighlight;
  ctx.fillStyle = canvasTheme.trimHighlight;
  ctx.lineWidth = LINE_WIDTH_PX;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  target.highlight.forEach((point, index) => {
    const { x, y } = toCanvas(point);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  for (const crossing of [target.start, target.end]) {
    if (crossing === null) continue;
    const { x, y } = toCanvas(crossing.point);
    ctx.beginPath();
    ctx.arc(x, y, END_RADIUS_PX, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

const layerStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
};
