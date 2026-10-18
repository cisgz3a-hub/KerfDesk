import { normalizeGcodeDialectSelection } from '../../core/devices';
import { isKnownControllerKind } from '../../core/devices/device-profile';
import { positioningLightIssue } from '../../core/devices/positioning-light';

/** An invalid (or since-tightened) light mapping is dropped with a review note
 * instead of refusing the whole profile, so a saved last machine still
 * restores; the light is configured again in Device Setup. */
export function recoverPositioningLight(value: Record<string, unknown>): {
  readonly value: Record<string, unknown>;
  readonly notes: ReadonlyArray<string>;
} {
  const kind = value['controllerKind'];
  const issue = positioningLightIssue(
    value['positioningLight'],
    isKnownControllerKind(kind) ? kind : undefined,
    normalizeGcodeDialectSelection(value['gcodeDialect']).dialectId,
  );
  if (issue === null) return { value, notes: [] };
  const { positioningLight: _invalid, ...rest } = value;
  return {
    value: rest,
    notes: [`Positioning light removed: ${issue} Set it up again in Device Setup.`],
  };
}
