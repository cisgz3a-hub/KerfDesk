// cnc-detected-apply — read the connected controller's detected `$30` as a CNC
// spindle S scale. It is a scale only while the controller reports laser mode
// off ($32=0), and even then it is not evidence of physical RPM: Machine Setup
// copies it to spindleMaxRpm only when the operator explicitly selects the
// numerical S-to-RPM mapping (ADR-111, ADR-322 §6).

import type { ControllerSettingsSnapshot } from '../../core/controllers/grbl';

export function cncDetectedSpindleScale(
  detected: Pick<ControllerSettingsSnapshot, 'maxPowerS' | 'laserModeEnabled'> | null,
): number | undefined {
  const value = detected?.maxPowerS;
  return detected?.laserModeEnabled === false &&
    value !== undefined &&
    Number.isFinite(value) &&
    value > 0
    ? value
    : undefined;
}
