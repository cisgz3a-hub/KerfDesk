// The card that follows the pointer over a move (ADR-470): its source line,
// kind, position, feed and power, and when the tool reaches it. Clicking the
// move jumps the source view and the playhead there. The card is a pointer
// convenience; the source pane and the timeline reach the same places from
// the keyboard.

import type { RefObject } from 'react';
import type { GcodeRenderModel } from '../../core/gcode-view';
import type { Viewer3dSceneHandle } from '../viewer3d';
// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import type { Viewer3dPick } from '../viewer3d/scene-pick';
import { moveReadout } from './pick-readout';
import { useMovePointer, type MoveHover } from './use-move-pointer';
import './inspector-pick.css';

export type MovePickProps = {
  readonly model: GcodeRenderModel;
  readonly segTimeEndSec: Float32Array | null;
  /** The pointed move, and the point along it, for click-to-line. */
  readonly onLocate: (pick: Viewer3dPick) => void;
};

/** While measuring, clicks set points (snapped to move ends) instead of locating. */
export type MoveTipMeasure = {
  readonly addPoint: (pick: Viewer3dPick) => void;
  readonly hover: (pick: Viewer3dPick | null) => void;
  readonly clickHint: string;
};

const CARD_GAP_PX = 16;
// Room the card needs before it flips to the pointer's other side.
const CARD_WIDTH_PX = 250;
const CARD_HEIGHT_PX = 96;

export function InspectorMoveTip(
  props: MovePickProps & {
    readonly canvasRef: RefObject<HTMLCanvasElement | null>;
    readonly handleRef: RefObject<Viewer3dSceneHandle | null>;
    readonly enabled: boolean;
    readonly paused: boolean;
    readonly measure: MoveTipMeasure | null;
  },
): JSX.Element | null {
  const { measure } = props;
  const hover = useMovePointer({
    canvasRef: props.canvasRef,
    handleRef: props.handleRef,
    enabled: props.enabled,
    paused: props.paused,
    resetKey: props.model,
    onLocate: measure?.addPoint ?? props.onLocate,
    onHover: measure?.hover,
  });
  if (hover === null || hover.pick.segmentIndex >= props.model.segmentCount) return null;
  // Measuring shows the point a click would take: the move's end when snapped.
  const snapped = measure !== null && hover.pick.vertex !== null;
  const pick = snapped
    ? { ...hover.pick, point: hover.pick.vertex ?? hover.pick.point }
    : hover.pick;
  const readout = moveReadout(props.model, props.segTimeEndSec, pick);
  return (
    <div className="gcode-viewer-move-tip" style={cardPlacement(hover)} aria-hidden="true">
      <strong>{readout.title}</strong>
      <span>{readout.position}</span>
      <span>{readout.settings}</span>
      {readout.time !== null ? <span>{readout.time}</span> : null}
      <em>
        {measure === null
          ? 'Click to go to this line'
          : `${measure.clickHint}${snapped ? ' (end of move)' : ''}`}
      </em>
    </div>
  );
}

function cardPlacement(hover: MoveHover): React.CSSProperties {
  const flipX = hover.xPx + CARD_GAP_PX + CARD_WIDTH_PX > hover.widthPx;
  const flipY = hover.yPx + CARD_GAP_PX + CARD_HEIGHT_PX > hover.heightPx;
  return {
    left: flipX ? undefined : hover.xPx + CARD_GAP_PX,
    right: flipX ? hover.widthPx - hover.xPx + CARD_GAP_PX : undefined,
    top: flipY ? undefined : hover.yPx + CARD_GAP_PX,
    bottom: flipY ? hover.heightPx - hover.yPx + CARD_GAP_PX : undefined,
  };
}
