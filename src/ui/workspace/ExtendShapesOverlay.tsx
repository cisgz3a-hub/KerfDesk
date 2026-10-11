import { useLayoutEffect, useMemo, useRef } from 'react';
import type { ExtendTarget } from '../../core/geometry/extend-shapes';
import type { Project, Vec2 } from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { canvasTheme } from '../theme/canvas-theme';
import {
  EXTEND_PICK_TOLERANCE_PX,
  extendHoverTarget,
  extendStatusMessage,
} from './extend-shapes-tool';
import type { CanvasBitmapSize } from './use-canvas-bitmap-size';
import { computeView, type ViewState, type ViewTransform } from './view-transform';

export function ExtendShapesOverlay(props: {
  readonly project: Project;
  readonly canvasSize: CanvasBitmapSize;
  readonly viewState: ViewState;
  readonly enabled: boolean;
}): JSX.Element | null {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const active = useUiStore((state) => state.toolMode.kind === 'extend-shapes') && props.enabled;
  const cursor = useStore((state) => (active ? state.cursorMm : null));
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
        ? extendHoverTarget(scene, cursor, EXTEND_PICK_TOLERANCE_PX / view.scale)
        : null,
    [active, cursor, scene, view.scale],
  );
  useLayoutEffect(() => {
    const ctx = ref.current?.getContext('2d') ?? null;
    if (ctx === null) return;
    ctx.clearRect(0, 0, width, height);
    if (target !== null) drawExtendTarget(ctx, target, view);
  }, [target, view, width, height]);
  if (!active) return null;
  return (
    <>
      <canvas
        ref={ref}
        width={width}
        height={height}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
        aria-hidden="true"
        data-testid="extend-shapes-layer"
      />
      {target !== null && (
        <div
          role="status"
          data-testid="extend-shapes-status"
          style={{
            position: 'absolute',
            top: 36,
            left: 12,
            padding: '6px 10px',
            background: 'var(--lf-bg-1)',
            color: 'var(--lf-text)',
            borderRadius: 6,
            pointerEvents: 'none',
            fontSize: 12,
          }}
        >
          {extendStatusMessage(target.status)}
        </div>
      )}
    </>
  );
}

function drawExtendTarget(
  ctx: CanvasRenderingContext2D,
  target: ExtendTarget,
  view: ViewTransform,
): void {
  const toCanvas = (point: Vec2) => ({
    x: view.offsetX + point.x * view.scale,
    y: view.offsetY + point.y * view.scale,
  });
  const from = toCanvas(target.from);
  ctx.save();
  ctx.strokeStyle = target.status === 'ready' ? canvasTheme.snapGuide : canvasTheme.trimHighlight;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(from.x, from.y, 5, 0, Math.PI * 2);
  ctx.stroke();
  if (target.status === 'ready' && target.to !== null) {
    const to = toCanvas(target.to);
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(to.x, to.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
