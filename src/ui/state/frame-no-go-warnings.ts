// frame-no-go-warnings — the configured no-go zones a Frame's own XY route
// crosses (audit v3 D5-P2-3, ADR-232 Amendment 1). The route is the tool-off
// approach from the head, the traced perimeter and the return leg, the same
// one buildFrameDispatchPlan sends. A crossing is a warning, never a refusal
// (ADR-232): runFrame shows it as it sends the Frame, as a jog's crossing is
// shown, and a project Frame's candidate carries it into Start's Job Review.
//
// The route is compared only through a verified native-to-bed frame, the rule
// Start's own zone scan follows (trustedMotionOffsetForPreflight). Without one
// Job Review already says zones cannot be checked, so the Frame adds nothing.

import type { FrameBounds } from '../../core/controllers/controller-driver';
import type { NoGoZone } from '../../core/devices';
import { nativePointToBed } from '../../core/devices/native-bed-frame';
import { buildFramePerimeter } from '../../core/job/frame-perimeter';
import { firstZoneCrossedBySegment } from '../../core/preflight';
import { activeCncTool, type Project } from '../../core/scene';
import { reportedWorkPositionMm } from './canvas-motion-plan';
import { inferCurrentMachinePosition } from './infer-machine-position';
import type { LaserState } from './laser-store';
import { resolveNativeBedFrame, selectNativeBedEvidence } from './native-bed-frame';

type Point = { readonly x: number; readonly y: number };
type FrameLeg = 'approach' | 'outline' | 'return';
export type LegPath = { readonly leg: FrameLeg; readonly points: ReadonlyArray<Point> };

/** One warning per enabled zone the Frame route crosses. `bounds` carries the
 * Frame's start point; it and `returnToWorkPosition` are in work coordinates.
 * A CNC Frame adds the active bit's radius, as the CNC job scan does for
 * travel at safe Z. Callers go through frameRouteNoGoWarnings. */
export function frameNoGoZoneWarnings(
  state: LaserState,
  project: Project,
  bounds: FrameBounds,
  returnToWorkPosition: Point | undefined,
): ReadonlyArray<string> {
  const zones = project.device.noGoZones.filter((zone) => zone.enabled);
  if (zones.length === 0) return [];
  const legs = frameRouteOnBed(state, project, bounds, returnToWorkPosition);
  if (legs === null) return [];
  const machine = project.machine;
  const radiusMm = machine?.kind === 'cnc' ? activeCncTool(machine).diameterMm / 2 : 0;
  return zones.flatMap((zone) => {
    const envelope = expandZone(zone, radiusMm);
    const crossed = legs.filter(({ points }) => pathCrosses(points, envelope));
    return crossed.length === 0
      ? []
      : [
          crossingMessage(
            zone,
            crossed.map(({ leg }) => leg),
            radiusMm,
          ),
        ];
  });
}

/** The Frame's route on the bed, through a verified native-to-bed frame and the
 *  controller's own work offset, or null without either. */
export function frameRouteOnBed(
  state: LaserState,
  project: Project,
  bounds: FrameBounds,
  returnToWorkPosition: Point | undefined,
): ReadonlyArray<LegPath> | null {
  const frame = resolveNativeBedFrame(project.device, selectNativeBedEvidence(state));
  if (frame === null) return null;
  const inches = state.controllerSettings?.reportInches === true;
  const machine = inferCurrentMachinePosition(state.statusReport, state.wcoCache, inches);
  const work = reportedWorkPositionMm(state, inches);
  if (machine === null || work === null) return null;
  // The controller's own offset (machine minus work position) puts the work
  // route in native machine coordinates, as an external Frame outline is.
  const workToBed = (point: Point): Point =>
    nativePointToBed({ x: point.x + machine.x - work.x, y: point.y + machine.y - work.y }, frame);
  const perimeter = buildFramePerimeter(bounds, bounds.startPoint).map(workToBed);
  const start = perimeter[0];
  if (start === undefined) return null;
  // The perimeter is closed, so the return leg starts where it began.
  return [
    { leg: 'approach', points: [nativePointToBed(machine, frame), start] },
    { leg: 'outline', points: perimeter },
    ...(returnToWorkPosition === undefined
      ? []
      : [{ leg: 'return' as const, points: [start, workToBed(returnToWorkPosition)] }]),
  ];
}

function pathCrosses(points: ReadonlyArray<Point>, zone: NoGoZone): boolean {
  return points.some((point, index) => {
    const next = points[index + 1];
    return next !== undefined && firstZoneCrossedBySegment(point, next, [zone]) !== null;
  });
}

function expandZone(zone: NoGoZone, radiusMm: number): NoGoZone {
  if (radiusMm <= 0) return zone;
  return {
    ...zone,
    x: zone.x - radiusMm,
    y: zone.y - radiusMm,
    width: zone.width + 2 * radiusMm,
    height: zone.height + 2 * radiusMm,
  };
}

function crossingMessage(zone: NoGoZone, legs: ReadonlyArray<FrameLeg>, radiusMm: number): string {
  const verb = legs.length === 1 ? 'crosses' : 'cross';
  const cutter = radiusMm > 0 ? ` (cutter radius ${radiusMm.toFixed(3)} mm included)` : '';
  return (
    `The Frame's ${listLegs(legs)} ${verb} the configured no-go zone "${zone.name}"${cutter}. ` +
    'The Frame is sent unchanged; watch the move and stop it, or use the physical E-stop, if needed.'
  );
}

function listLegs(legs: ReadonlyArray<FrameLeg>): string {
  if (legs.length <= 1) return legs[0] ?? 'outline';
  return `${legs.slice(0, -1).join(', ')} and ${legs[legs.length - 1]}`;
}
