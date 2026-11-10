// frame-bed-edge-warning — a Frame whose route leaves the configured bed, on
// every controller (UX audit U4-P2-4, ADR-232 Amendment 2).
//
// grblHAL got a Frame-time warning past its homed area (ADR-637 Amendment 5)
// and a jog past the bed is warned (laser-jog-warnings.ts), but a stock GRBL,
// FluidNC or Marlin Frame that drove the head 70 mm past a never-homed bed's
// edge said "Frame complete". With `$20=0` nothing stops it and the steppers
// skip at the rail end. The Frame is compared in the jog's convention
// (nativePointsOnBed): through a verified native-to-bed frame, or, on a machine
// that was never homed, with machine zero where the head was when the
// controller started, which the warning then says. Bed bounds stay guidance
// (ADR-228): the Frame is sent unchanged, and a project Frame's candidate
// carries the warning into Start's Job Review (ADR-232 Amendment 1).

import type { FrameBounds } from '../../core/controllers/controller-driver';
import { buildFramePerimeter } from '../../core/job/frame-perimeter';
import type { Project } from '../../core/scene';
import { reportedWorkPositionMm } from './canvas-motion-plan';
import { farthestOutside } from './frame-homed-area-warning';
import { formatBed } from './homed-area-bed';
import { inferCurrentMachinePosition } from './infer-machine-position';
import { configuredMotionBounds, nativePointsOnBed } from './laser-jog-warnings';
import type { LaserState } from './laser-store';
import { resolveNativeBedFrame, selectNativeBedEvidence } from './native-bed-frame';
import { formatUpTo3Decimals } from '../../core/util/number-format';

type Point = { readonly x: number; readonly y: number };

export const FRAME_BED_ASSUMED_CORNER_NOTE =
  "This machine has not been homed, so the bed check assumes the head was at the bed's " +
  'corner (machine zero) when the controller was switched on.';

/** The warning for a Frame route (approach, outline and return) that leaves
 *  the configured bed, or null when it stays on it or no bed comparison is
 *  meaningful (a homed machine without a verified native frame). */
export function frameBedEdgeWarning(
  state: LaserState,
  project: Project,
  bounds: FrameBounds,
  returnToWorkPosition: Point | undefined,
): string | null {
  const inches = state.controllerSettings?.reportInches === true;
  const machine = inferCurrentMachinePosition(state.statusReport, state.wcoCache, inches);
  const work = reportedWorkPositionMm(state, inches);
  if (machine === null || work === null) return null;
  // The controller's own offset (machine minus work position) puts the work
  // route in native machine coordinates, as frameRouteOnBed does.
  const toNative = (point: Point): Point => ({
    x: point.x + machine.x - work.x,
    y: point.y + machine.y - work.y,
  });
  const route = [
    machine,
    ...buildFramePerimeter(bounds, bounds.startPoint).map(toNative),
    ...(returnToWorkPosition === undefined ? [] : [toNative(returnToWorkPosition)]),
  ];
  const onBed = nativePointsOnBed(state, project.device, route);
  if (onBed === null) return null;
  const bed = configuredMotionBounds(project.device, project.machine?.kind);
  const farthest = farthestOutside(onBed, bed);
  if (farthest === null) return null;
  const assumed = resolveNativeBedFrame(project.device, selectNativeBedEvidence(state)) === null;
  const size = formatBed({ widthMm: bed.maxX - bed.minX, heightMm: bed.maxY - bed.minY });
  return (
    `The Frame reaches ${farthest}, past the edge of the ${size} bed ` +
    `(X ${formatUpTo3Decimals(bed.minX)} to ${formatUpTo3Decimals(bed.maxX)}, Y ${formatUpTo3Decimals(bed.minY)} to ${formatUpTo3Decimals(bed.maxY)} mm). ` +
    (assumed ? `${FRAME_BED_ASSUMED_CORNER_NOTE} ` : '') +
    'The Frame is sent unchanged; watch the move and stop it, or use the physical E-stop, if ' +
    'needed. Move the origin or the design to keep the job on the bed.'
  );
}
