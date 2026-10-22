import { normalizeGcodeDialectSelection } from '../../core/devices';
import { isKnownControllerKind } from '../../core/devices/device-profile';
import {
  devicePositioningLightIssue,
  LASER_DOT_COMMAND_SET,
} from '../../core/devices/positioning-light';

/** An invalid (or since-tightened) light mapping is dropped with a review note
 * instead of refusing the whole profile, so a saved last machine still
 * restores; the light is configured again in Device Setup. */
export function recoverPositioningLight(value: Record<string, unknown>): {
  readonly value: Record<string, unknown>;
  readonly notes: ReadonlyArray<string>;
} {
  const kind = value['controllerKind'];
  const commandSet = value['controllerCommandSet'];
  const issue = devicePositioningLightIssue({
    positioningLight: value['positioningLight'],
    controllerKind: isKnownControllerKind(kind) ? kind : undefined,
    // Only the laser dot reads this, and only as an exact match.
    controllerCommandSet: commandSet === LASER_DOT_COMMAND_SET ? LASER_DOT_COMMAND_SET : undefined,
    gcodeDialect: normalizeGcodeDialectSelection(value['gcodeDialect']),
  });
  if (issue === null) return { value, notes: [] };
  const { positioningLight: _invalid, ...rest } = value;
  return {
    value: rest,
    notes: [`Positioning light removed: ${issue} Set it up again in Device Setup.`],
  };
}
