import { useRef } from 'react';
import { APP_DISPLAY_NAME } from '../../core/app-branding';
import type { Project } from '../../core/scene';
import { canvasTheme } from '../theme/canvas-theme';
import type { CanvasMotionOverlay } from './draw-canvas-motion';
import type { CanvasBitmapSize } from './use-canvas-bitmap-size';
import { useCanvasMotionLayer } from './use-canvas-motion-layer';
import type { ViewState } from './view-transform';
import { CanvasTextEditor } from '../text/CanvasTextEditor';
import {
  handleCanvasDoubleClick,
  workspaceTextPointerHandlers,
} from './workspace-text-interaction';

export function WorkspaceCanvasLayers(props: {
  readonly baseRef: React.MutableRefObject<HTMLCanvasElement | null>;
  readonly canvasSize: CanvasBitmapSize;
  readonly handlers: {
    readonly onPointerDown: React.PointerEventHandler<HTMLCanvasElement>;
    readonly onPointerMove: React.PointerEventHandler<HTMLCanvasElement>;
    readonly onPointerUp: React.PointerEventHandler<HTMLCanvasElement>;
    readonly onPointerCancel: React.PointerEventHandler<HTMLCanvasElement>;
    readonly onLostPointerCapture: React.PointerEventHandler<HTMLCanvasElement>;
  };
  readonly project: Project;
  readonly previewMode: boolean;
  readonly viewState: ViewState;
  readonly canvasMotionOverlay: CanvasMotionOverlay | null;
}): JSX.Element {
  const motionRef = useRef<HTMLCanvasElement | null>(null);
  const handlers = workspaceTextPointerHandlers({ ...props, canvasRef: props.baseRef });
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
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerCancel={handlers.onPointerCancel}
        onLostPointerCapture={handlers.onLostPointerCapture}
        onDoubleClick={handleCanvasDoubleClick}
        onContextMenu={suppressCanvasContextMenu}
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
      <CanvasTextEditor
        canvasRef={props.baseRef}
        canvasSize={props.canvasSize}
        project={props.project}
        viewState={props.viewState}
      />
    </>
  );
}

function suppressCanvasContextMenu(event: React.MouseEvent<HTMLCanvasElement>): void {
  event.preventDefault();
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
