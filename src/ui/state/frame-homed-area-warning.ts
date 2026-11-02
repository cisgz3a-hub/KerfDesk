// frame-homed-area-warning — a Frame whose route leaves grblHAL's homed area
// (rolling audit v9 R6-P2-3, ADR-637 Amendment 5).
//
// A bed widened to the controller's whole travel frames and runs past the
// envelope, and with `$20=0` nothing stops it. Like a no-go zone crossing,
// this is a warning: runFrame shows it as it sends the Frame unchanged, and a
// project Frame's candidate carries it into Start's Job Review (ADR-232
// Amendment 1). The route is the one frameNoGoZoneWarnings compares.

import type { FrameBounds } from '../../core/controllers/controller-driver';
import { nativePointToBed } from '../../core/devices/native-bed-frame';
import type { Project } from '../../core/scene';
import { frameRouteOnBed } from './frame-no-go-warnings';
import { bedWiderThanHomedArea, formatBed, grblHalHomedEnvelope } from './homed-area-bed';
import type { LaserState } from './laser-store';
import { resolveNativeBedFrame, selectNativeBedEvidence } from './native-bed-frame';

type Point = { readonly x: number; readonly y: number };

// Under a thousandth of a millimetre past the edge is the edge.
const EDGE_MM = 1e-3;

/** The warning for a Frame route that leaves grblHAL's homed envelope, or
 *  null when it stays inside, or when the envelope or the route on the bed is
 *  not known. */
export function frameHomedAreaWarning(
  state: LaserState,
  project: Project,
  bounds: FrameBounds,
  returnToWorkPosition: Point | undefined,
): string | null {
  const evidence = selectNativeBedEvidence(state);
  const envelope = grblHalHomedEnvelope(evidence);
  const frame = resolveNativeBedFrame(project.device, evidence);
  if (envelope === null || frame === null) return null;
  const legs = frameRouteOnBed(state, project, bounds, returnToWorkPosition);
  if (legs === null) return null;
  const low = nativePointToBed({ x: envelope.minX, y: envelope.minY }, frame);
  const high = nativePointToBed({ x: envelope.maxX, y: envelope.maxY }, frame);
  const box = { minX: low.x, minY: low.y, maxX: high.x, maxY: high.y };
  const farthest = farthestOutside(
    legs.flatMap((leg) => leg.points),
    box,
  );
  if (farthest === null) return null;
  const homed = { widthMm: box.maxX - box.minX, heightMm: box.maxY - box.minY };
  const widened = bedWiderThanHomedArea(project.device, evidence);
  const bed = formatBed({ widthMm: project.device.bedWidth, heightMm: project.device.bedHeight });
  return (
    `The Frame reaches ${farthest} on the bed, past the controller's homed area ` +
    `(X ${mm(box.minX)} to ${mm(box.maxX)}, Y ${mm(box.minY)} to ${mm(box.maxY)} mm after the homing pull-off). ` +
    `This profile's bed is ${bed}${widened === null ? '' : ", the controller's whole travel"}; ` +
    `correct it to ${formatBed(homed)} in Machine Setup. ` +
    'The Frame is sent unchanged; watch the move and stop it, or use the physical E-stop, if needed.'
  );
}

// The route point farthest outside the box, named by the axes it is outside on.
function farthestOutside(
  points: ReadonlyArray<Point>,
  box: { minX: number; minY: number; maxX: number; maxY: number },
): string | null {
  let worst: { point: Point; past: number; x: boolean; y: boolean } | null = null;
  for (const point of points) {
    const pastX = Math.max(box.minX - point.x, point.x - box.maxX, 0);
    const pastY = Math.max(box.minY - point.y, point.y - box.maxY, 0);
    const past = Math.max(pastX, pastY);
    if (past > EDGE_MM && (worst === null || past > worst.past))
      worst = { point, past, x: pastX > EDGE_MM, y: pastY > EDGE_MM };
  }
  if (worst === null) return null;
  return [
    ...(worst.x ? [`X ${mm(worst.point.x)}`] : []),
    ...(worst.y ? [`Y ${mm(worst.point.y)}`] : []),
  ].join(', ');
}

function mm(value: number): string {
  return Number(value.toFixed(3)).toString();
}
