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
 * `feed-matched-every-sweep` is the generic Scan Line quality policy: every
 * independent sweep gets a feed-matched laser-off entry and exit, with adjacent
 * split runways sharing the available blank gap. `feed-matched-entry` retains
 * ADR-234's 5 mm cap and now also owns bounded exits (ADR-445). The remaining values are retained for
 * explicit legacy fixtures and for the raster-to-fill planner model.
 */
export type FillRunwayPolicy =
  | 'feed-matched-every-sweep'
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
  // ADR-234's 5 mm limit remains; ADR-445 shares internal gaps between entry
  // and exit. Sensitive Island Fill keeps its configured full outer runway.
  return fillStyle === 'island' ? 'full' : 'feed-matched-entry';
}

// The generic 400 x 400 starter is deliberately not treated as proof of
// Neotronics hardware. It is, however, the ambiguous profile operators can
// accidentally leave selected on a real 4040. Surface a conditional advisory
// for that starter (and for a declared 4040 profile whose dialect drifted)
// without warning Falcon or unrelated custom profiles.
//
// "My machine isn't listed" saves its machine on the generic starter's
// profile id (ADR-637), but the 4040 is in that list, so a machine named
// there, or given another bed, has been declared not to be one (UX audit
// U3-P3-6, ADR-687). Only the starter as it ships is still ambiguous.
export function shouldAdvise4040FillPolicySelection(device: DeviceProfile): boolean {
  if (fillRunwayPolicyForDevice(device) !== undefined) return false;
  return (
    isUnnamedGenericStarter(device) ||
    device.profileId === NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE.profileId ||
    device.machineFamily === NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE.machineFamily
  );
}

function isUnnamedGenericStarter(device: DeviceProfile): boolean {
  return (
    device.profileId === DEFAULT_DEVICE_PROFILE.profileId &&
    device.name === DEFAULT_DEVICE_PROFILE.name &&
    device.bedWidth === DEFAULT_DEVICE_PROFILE.bedWidth &&
    device.bedHeight === DEFAULT_DEVICE_PROFILE.bedHeight
  );
}
