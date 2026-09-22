import type { DeviceProfile } from '../../core/devices';
import type { JobOriginPlacement, JobPlacementSettings } from '../../core/job';
import { resolveJobPlacement, runtimeCoordinatePreparationOptions } from '../job-placement';
import type { LaserState } from '../state/laser-store';

export type StartPreparationPlacement = {
  readonly jobPlacement: JobPlacementSettings;
  readonly resolvedJobOrigin?: JobOriginPlacement;
};

/** Inputs to a new compilation only. A completed Frame owns its sealed bytes
 * and must not be invalidated by a later advisory settings/build refresh. */
export function startPreparationCoordinateKey(
  device: DeviceProfile,
  source: LaserState,
  context: StartPreparationPlacement,
): string {
  const resolved = context.resolvedJobOrigin;
  const live = resolveJobPlacement(resolved ?? context.jobPlacement, {
    statusReport: source.statusReport,
    workOriginActive: source.workOriginActive,
    wcoCache: source.wcoCache,
    reportInches: source.controllerSettings?.reportInches === true,
  });
  if (!live.ok) return JSON.stringify(live);
  const placement = resolved === undefined ? live : { ...live, jobOrigin: resolved };
  return JSON.stringify(runtimeCoordinatePreparationOptions(device, placement, source));
}
