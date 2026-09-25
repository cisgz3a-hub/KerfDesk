import type { DeviceProfile } from '../../core/devices';

/** Where a machine-profile document came from. A file is not bound to this
 * physical machine and laser head, so its scan offsets need a fresh
 * verification burn; this workstation's own My machines slot (ADR-374)
 * restores exactly what the operator saved on it. */
export type MachineProfileProvenance = 'file' | 'workstation';

export function calibrationForProvenance(
  canonical: DeviceProfile,
  provenance: MachineProfileProvenance,
): { readonly profile: DeviceProfile; readonly notes: ReadonlyArray<string> } {
  if (provenance === 'workstation' || canonical.scanningOffsets.length === 0) {
    return { profile: canonical, notes: [] };
  }
  return {
    profile: { ...canonical, scanOffsetCalibrationStatus: 'pending' },
    notes: [
      'Imported scan-offset values were kept but marked verification pending because the file does not bind them to this physical machine and laser head.',
    ],
  };
}
