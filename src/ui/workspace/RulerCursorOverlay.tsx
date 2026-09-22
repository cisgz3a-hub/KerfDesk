// Live pointer position on both ruler strips (ADR-348).
//
// DOM, not canvas, and deliberately: the scene redraw does not depend on
// `cursorMm`, so painting the marker into the rulers would mean redrawing
// every object in the project on every mouse-move. Two absolutely positioned
// marks over the ruler bands cost one tiny React render instead — the same
// cadence the status bar already pays for its X/Y readout.
//
// Canvas bitmap size equals its CSS size (use-canvas-bitmap-size), so canvas
// pixels and layout pixels are the same number and the marks land exactly on
// the ticks underneath.

import type { Project } from '../../core/scene';
import { useStore } from '../state';
import { RULER_THICKNESS_PX } from './canvas-layout';
import type { CanvasBitmapSize } from './use-canvas-bitmap-size';
import { computeView, type ViewState } from './view-transform';

export function RulerCursorOverlay(props: {
  readonly project: Project;
  readonly canvasSize: CanvasBitmapSize;
  readonly viewState: ViewState;
}): JSX.Element | null {
  const cursor = useStore((state) => state.cursorMm);
  if (cursor === null) return null;
  const view = computeView(
    props.canvasSize.width,
    props.canvasSize.height,
    props.project.device.bedWidth,
    props.project.device.bedHeight,
    props.viewState,
  );
  const x = view.offsetX + cursor.x * view.scale;
  const y = view.offsetY + cursor.y * view.scale;
  const onHorizontal = x >= RULER_THICKNESS_PX && x <= props.canvasSize.width;
  const onVertical = y >= RULER_THICKNESS_PX && y <= props.canvasSize.height;
  if (!onHorizontal && !onVertical) return null;
  return (
    <div aria-hidden="true" data-testid="ruler-cursor" style={overlayStyle}>
      {onHorizontal ? <span style={{ ...horizontalMarkStyle, left: x }} /> : null}
      {onVertical ? <span style={{ ...verticalMarkStyle, top: y }} /> : null}
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 3,
  pointerEvents: 'none',
};

const markStyle: React.CSSProperties = {
  position: 'absolute',
  background: 'var(--lf-accent)',
  opacity: 0.85,
};

const horizontalMarkStyle: React.CSSProperties = {
  ...markStyle,
  top: 0,
  width: 1,
  height: RULER_THICKNESS_PX,
};

const verticalMarkStyle: React.CSSProperties = {
  ...markStyle,
  left: 0,
  height: 1,
  width: RULER_THICKNESS_PX,
};
