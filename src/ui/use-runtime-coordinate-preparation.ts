import { useMemo } from 'react';
import type { DeviceProfile } from '../core/devices';
import { runtimeCoordinatePreparationOptions, type ResolvedJobPlacement } from './job-placement';
import { useLaserStore } from './state/laser-store';
import { selectNativeBedEvidence } from './state/native-bed-frame';

export type RuntimeCoordinatePreparation = ReturnType<typeof runtimeCoordinatePreparationOptions>;

/** Hold the semantic preparation inputs across unchanged controller polls.
 * Envelope or reference changes still replace the preview and ETA together. */
export function useRuntimeCoordinatePreparation(
  device: DeviceProfile,
  placement: ResolvedJobPlacement,
): RuntimeCoordinatePreparation {
  // Select the evidence by identity and derive from it during render: deriving
  // inside the selector stringified the options on every store set, three
  // mounts at a time, for the whole of a streamed job.
  const evidence = useLaserStore(selectNativeBedEvidence);
  const key = useMemo(
    () =>
      JSON.stringify(
        placement.ok
          ? runtimeCoordinatePreparationOptions(device, placement, evidence)
          : { contourEntryBounds: null },
      ),
    [device, placement, evidence],
  );
  return useMemo(() => JSON.parse(key) as RuntimeCoordinatePreparation, [key]);
}
