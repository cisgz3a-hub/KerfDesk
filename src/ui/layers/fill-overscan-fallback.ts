import type { DeviceProfile } from '../../core/devices';
import { fillRunwayPolicyForDevice } from '../../core/job/fill-runway-policy';
import {
  feedMatchedFillRunwayMm,
  genericFeedMatchedFillRunwayMm,
} from '../../core/job/fill-sweep-plan';

/**
 * Describes a stored Scan Line overscan the active machine will not use as
 * typed: the generic default replaces a non-positive value, and the 4040-safe
 * entry runway stops at its ADR-234 bound. Null when the stored value applies.
 */
export function scanLineOverscanNote(
  device: DeviceProfile,
  storedOverscanMm: number,
): string | null {
  if (fillRunwayPolicyForDevice(device) === 'feed-matched-entry') {
    const boundMm = feedMatchedFillRunwayMm(storedOverscanMm);
    return storedOverscanMm > boundMm
      ? `stored ${storedOverscanMm}; 4040-safe Scan Line uses up to ${boundMm} mm`
      : null;
  }
  return storedOverscanMm <= 0
    ? `stored ${storedOverscanMm}; generic effective target ${genericFeedMatchedFillRunwayMm(storedOverscanMm)} mm`
    : null;
}
