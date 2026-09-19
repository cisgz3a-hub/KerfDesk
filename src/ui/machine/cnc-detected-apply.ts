// cnc-detected-apply — decide what the connected controller's detected `$$`
// settings can fill on the CNC machine. $30 is a configured S scale: only an
// explicit RPM mapping copies it to spindleMaxRpm. $130/$131 fill the shared
// device bed — NOT the stock, which is the workpiece on the bed, not the
// machine envelope. Pure so the panel row and its test share one source of
// truth, and so the row renders (and Apply acts) only when something differs.

import type { ControllerSettingsSnapshot } from '../../core/controllers/grbl';
import type { CncMachineConfig } from '../../core/scene';

export type CncDetectedApply = {
  readonly paramsPatch: { readonly spindleMaxRpm?: number };
  readonly devicePatch: { readonly bedWidth?: number; readonly bedHeight?: number };
  // Human-readable list of what Apply would change, e.g. "spindle max 24000
  // RPM, bed 400×400 mm". Empty summary ⇒ the whole call returns null.
  readonly summary: string;
};

type BedDims = { readonly bedWidth: number; readonly bedHeight: number };

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

export function computeCncDetectedApply(
  detected: ControllerSettingsSnapshot,
  machine: CncMachineConfig,
  device: BedDims,
  useSpindleScaleAsRpm = false,
): CncDetectedApply | null {
  // Even with $32=0, some spindle controllers use S1000 as a PWM scale.
  // CNC mode alone does not establish a numerical mapping to physical RPM.
  const spindleMaxRpm = useSpindleScaleAsRpm
    ? pickChanged(cncDetectedSpindleScale(detected), machine.params.spindleMaxRpm)
    : undefined;
  const bedWidth = pickChanged(detected.bedWidth, device.bedWidth);
  const bedHeight = pickChanged(detected.bedHeight, device.bedHeight);
  const paramsPatch = spindleMaxRpm === undefined ? {} : { spindleMaxRpm };
  const devicePatch = {
    ...(bedWidth === undefined ? {} : { bedWidth }),
    ...(bedHeight === undefined ? {} : { bedHeight }),
  };
  const summary = [
    ...(spindleMaxRpm === undefined
      ? []
      : [`spindle maximum ${spindleMaxRpm} RPM from selected S mapping`]),
    ...bedSummary(bedWidth, bedHeight),
  ].join(', ');
  if (summary === '') return null;
  return { paramsPatch, devicePatch, summary };
}

// A detected value worth offering: present AND different from the current one.
function pickChanged(detectedValue: number | undefined, current: number): number | undefined {
  return detectedValue !== undefined &&
    Number.isFinite(detectedValue) &&
    detectedValue > 0 &&
    detectedValue !== current
    ? detectedValue
    : undefined;
}

function bedSummary(bedWidth: number | undefined, bedHeight: number | undefined): string[] {
  if (bedWidth !== undefined && bedHeight !== undefined)
    return [`configured travel ${bedWidth}×${bedHeight} mm`];
  if (bedWidth !== undefined) return [`configured X travel ${bedWidth} mm`];
  if (bedHeight !== undefined) return [`configured Y travel ${bedHeight} mm`];
  return [];
}
