// The laser-off travel that opens each raster sweep (emit-raster.ts).

import { INTENTIONAL_LASER_OFF_MOTION_COMMENT } from '../gcode-comments';
import { formatGcodeFeedMmPerMin } from '../gcode/feed-word';
import {
  joinMotionWords,
  type ModalMotionWriter,
  type MotionWordStyle,
} from '../gcode/motion-words';

/** A head position on the controller's three-decimal grid. */
export type RasterControllerHead = { readonly x: number; readonly y: number };

type SweepOpeningInput = {
  readonly x: number;
  readonly y: number;
  readonly target: RasterControllerHead;
  readonly previousHead: RasterControllerHead | null;
  readonly constantPower: boolean;
  readonly controlledFeed: number | undefined;
};

/**
 * The sweep's opening travel and the power the controller then holds.
 *
 * Where two split runways meet (ADR-445), the previous sweep already closed
 * with S0 at this sweep's start. Under M3 GRBL drains its planner on a motion
 * line whose target is the current position (motion_control.c:67-76, grblHAL
 * motion_control.c:182-190), so that coincident travel would stop the head
 * between the islands and push the braking back into the burn. It is left out
 * there, and the first run restates its power. Under M4 the historical bytes
 * stay: the planner drops the empty block without stopping.
 */
export function rasterSweepOpening(
  input: SweepOpeningInput,
  writer: ModalMotionWriter,
  style: MotionWordStyle,
): { readonly lines: ReadonlyArray<string>; readonly prevS: number } {
  const previous = input.previousHead;
  if (input.constantPower && previous?.x === input.target.x && previous.y === input.target.y) {
    return { lines: [], prevS: -1 };
  }
  // The travel always carries S0, so a compact row may hold that modal power
  // rather than restating it on the first burn move.
  return {
    lines: [formatLaserOffTravel(input.x, input.y, input.controlledFeed, writer, style)],
    prevS: style.modalMotion ? 0 : -1,
  };
}

function formatLaserOffTravel(
  x: number,
  y: number,
  controlledFeed: number | undefined,
  writer: ModalMotionWriter,
  style: MotionWordStyle,
): string {
  if (controlledFeed !== undefined) {
    return joinMotionWords(
      [
        writer.motion('G1'),
        writer.axis('X', x),
        writer.axis('Y', y),
        `F${formatGcodeFeedMmPerMin(controlledFeed)}`,
        'S0',
      ],
      style,
      INTENTIONAL_LASER_OFF_MOTION_COMMENT,
    );
  }
  return joinMotionWords(
    [writer.motion('G0'), writer.axis('X', x), writer.axis('Y', y), 'S0'],
    style,
  );
}
