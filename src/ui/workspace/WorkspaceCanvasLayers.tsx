import { useRef } from 'react';
import { APP_DISPLAY_NAME } from '../../core/app-branding';
import type { Project } from '../../core/scene';
import { canvasTheme } from '../theme/canvas-theme';
import type { CanvasMotionOverlay } from './draw-canvas-motion';
import type { CanvasBitmapSize } from './use-canvas-bitmap-size';
import { useCanvasMotionLayer } from './use-canvas-motion-layer';
import type { ViewState } from './view-transform';

export function WorkspaceCanvasLayers(props: {
  readonly baseRef: React.MutableRefObject<HTMLCanvasElement | null>;
  readonly canvasSize: CanvasBitmapSize;
  readonly handlers: {
    readonly onPointerDown: React.PointerEventHandler<HTMLCanvasElement>;
    readonly onPointerMove: React.PointerEventHandler<HTMLCanvasElement>;
    readonly onPointerUp: React.PointerEventHandler<HTMLCanvasElement>;
  };
  readonly project: Project;
  readonly viewState: ViewState;
  readonly canvasMotionOverlay: CanvasMotionOverlay | null;
  readonly onDoubleClick: React.MouseEventHandler<HTMLCanvasElement>;
  readonly onContextMenu: React.MouseEventHandler<HTMLCanvasElement>;
}): JSX.Element {
  const motionRef = useRef<HTMLCanvasElement | null>(null);
  useCanvasMotionLayer({
    ref: motionRef,
    project: props.project,
    viewState: props.viewState,
    canvasSize: props.canvasSize,
    overlay: props.canvasMotionOverlay,
  });
  return (
    <>
      <canvas
        ref={props.baseRef}
        width={props.canvasSize.width}
        height={props.canvasSize.height}
        onPointerDown={props.handlers.onPointerDown}
        onPointerMove={props.handlers.onPointerMove}
        onPointerUp={props.handlers.onPointerUp}
        onPointerCancel={props.handlers.onPointerUp}
        onDoubleClick={props.onDoubleClick}
        onContextMenu={props.onContextMenu}
        style={canvasStyle}
        aria-label={`${APP_DISPLAY_NAME} workspace`}
      />
      <canvas
        ref={motionRef}
        width={props.canvasSize.width}
        height={props.canvasSize.height}
        style={canvasMotionLayerStyle}
        aria-hidden="true"
        data-testid="canvas-motion-layer"
      />
    </>
  );
}

const canvasStyle: React.CSSProperties = {
  display: 'block',
  background: canvasTheme.viewportSurround,
  width: '100%',
  height: '100%',
  touchAction: 'none',
};
const canvasMotionLayerStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
};
