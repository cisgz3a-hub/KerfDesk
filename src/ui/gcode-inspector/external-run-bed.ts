// external-run-bed — where an external program's Frame outline lands on the
// bed (ADR-630 Amendment 1). Configured bounds and no-go zones are operator
// guidance (ADR-232): an outline that leaves the bed or overlaps an enabled
// zone is a Run review warning, never a refusal, as a jog's path is
// (laser-jog-warnings.ts). The outline is in work coordinates; the
// controller's own offset (machine minus work position) puts it in native
// machine coordinates, which reach the bed the way a jog's do. The program's
// motion stays inside its outline, so a zone outside it is clear.

import type { DeviceProfile } from '../../core/devices';
import type { ExternalProgramEnvelope } from '../../core/external-program';
import { zonesOverlappingRect } from '../../core/preflight/no-go-zones';
import { reportedWorkPositionMm } from '../state/canvas-motion-plan';
import { inferCurrentMachinePosition } from '../state/infer-machine-position';
import { configuredMotionBounds, nativePointsOnBed } from '../state/laser-jog-warnings';
import type { LaserState } from '../state/laser-store';

export const OUTLINE_NOT_ON_BED =
  'KerfDesk cannot tell where the Frame outline lands on the bed (no machine position, or a homed machine whose bed position is not verified), so it is not compared with the configured machine bounds or no-go zones.';

type Rect = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

/** Warnings for where `envelope` lands on the bed; none until connected. */
export function externalOutlineBedWarnings(
  envelope: ExternalProgramEnvelope,
  laser: LaserState,
  device: DeviceProfile,
): ReadonlyArray<string> {
  if (laser.connection.kind !== 'connected' || laser.statusReport === null) return [];
  const rect = outlineOnBed(envelope, laser, device);
  if (rect === null) return [OUTLINE_NOT_ON_BED];
  const zones = zonesOverlappingRect(rect, device.noGoZones);
  return [
    ...outsideBoundsWarnings(rect, configuredMotionBounds(device)),
    ...zones.map(
      (zone) =>
        `The Frame outline overlaps the no-go zone "${zone.name}", so the program may move through it.`,
    ),
  ];
}

function outlineOnBed(
  envelope: ExternalProgramEnvelope,
  laser: LaserState,
  device: DeviceProfile,
): Rect | null {
  const inches = laser.controllerSettings?.reportInches === true;
  const machine = inferCurrentMachinePosition(laser.statusReport, laser.wcoCache, inches);
  const work = reportedWorkPositionMm(laser, inches);
  if (machine === null || work === null) return null;
  const dx = machine.x - work.x;
  const dy = machine.y - work.y;
  const corners = nativePointsOnBed(laser, device, [
    { x: envelope.minX + dx, y: envelope.minY + dy },
    { x: envelope.maxX + dx, y: envelope.maxY + dy },
  ]);
  const [a, b] = corners ?? [];
  if (a === undefined || b === undefined) return null;
  // A native-to-bed frame may flip an axis, so order the corners again.
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

function outsideBoundsWarnings(rect: Rect, bounds: Rect): ReadonlyArray<string> {
  const inside =
    rect.minX >= bounds.minX &&
    rect.maxX <= bounds.maxX &&
    rect.minY >= bounds.minY &&
    rect.maxY <= bounds.maxY;
  if (inside) return [];
  return [
    `The Frame outline reaches X ${range(rect.minX, rect.maxX)}, Y ${range(rect.minY, rect.maxY)} mm on the bed, outside the configured machine bounds X ${range(bounds.minX, bounds.maxX)}, Y ${range(bounds.minY, bounds.maxY)} mm. The Frame and the program still move there; the controller's own limits still apply.`,
  ];
}

function range(min: number, max: number): string {
  return `${min.toFixed(1)} to ${max.toFixed(1)}`;
}
