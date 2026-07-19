import {
  DEFAULT_DEVICE_PROFILE,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  resolveGrblDialect,
  type DeviceProfile,
} from '../devices';
import type { LayerFillStyle } from '../scene';

/**
 * Executable runway semantics carried by a compiled fill group.
 *
 * `feed-matched-entry` is the governing 4040 fill policy from ADR-234. The
 * remaining values are retained for explicit legacy fixtures and for the
 * raster-to-fill planner model. `raster-bounded` mirrors the emitter's
 * monotonic split-gap runways; `raster-full` preserves the former model.
 */
export type FillRunwayPolicy =
  | 'feed-matched-entry'
  | 'full'
  | 'raster-bounded'
  | 'raster-full'
  | 'legacy-skip'
  | 'island-capped';

export function fillRunwayPolicyForDevice(
  device: DeviceProfile,
  fillStyle: LayerFillStyle | undefined = 'scanline',
): FillRunwayPolicy | undefined {
  if (resolveGrblDialect(device).id !== 'neotronics-4040-safe') return undefined;
  // ADR-234 governs ordinary scanline Fill with bounded, non-overlapping entry
  // runways. Sensitive Island Fill keeps ADR-235's full two-sided runway.
  return fillStyle === 'island' ? 'full' : 'feed-matched-entry';
}

// The generic 400 x 400 starter is deliberately not treated as proof of
// Neotronics hardware. It is, however, the ambiguous profile operators can
// accidentally leave selected on a real 4040. Surface a conditional advisory
// for that starter (and for a declared 4040 profile whose dialect drifted)
// without warning Falcon or unrelated custom profiles.
export function shouldAdvise4040FillPolicySelection(device: DeviceProfile): boolean {
  if (fillRunwayPolicyForDevice(device) !== undefined) return false;
  return (
    device.profileId === DEFAULT_DEVICE_PROFILE.profileId ||
    device.profileId === NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE.profileId ||
    device.machineFamily === NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE.machineFamily
  );
}
