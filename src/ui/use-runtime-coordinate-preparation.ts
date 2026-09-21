import { useMemo } from 'react';
import type { DeviceProfile } from '../core/devices';
import { runtimeCoordinatePreparationOptions, type ResolvedJobPlacement } from './job-placement';
import { useLaserStore } from './state/laser-store';
import { nativeBedEvidenceSnapshot } from './state/native-bed-frame';

export type RuntimeCoordinatePreparation = ReturnType<typeof runtimeCoordinatePreparationOptions>;

/** Hold the semantic preparation inputs across unchanged controller polls.
 * Envelope or reference changes still replace the preview and ETA together. */
export function useRuntimeCoordinatePreparation(
  device: DeviceProfile,
  placement: ResolvedJobPlacement,
): RuntimeCoordinatePreparation {
  const key = useLaserStore((state) =>
    JSON.stringify(
      placement.ok
        ? runtimeCoordinatePreparationOptions(device, placement, nativeBedEvidenceSnapshot(state))
        : { contourEntryBounds: null },
    ),
  );
  return useMemo(() => JSON.parse(key) as RuntimeCoordinatePreparation, [key]);
}
