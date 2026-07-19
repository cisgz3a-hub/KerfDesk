// cnc-detected-apply — decide what the connected controller's detected `$$`
// settings can fill on the CNC machine (ADR-111). GRBL $30 (max spindle RPM)
// fills the CNC params' spindleMaxRpm; $130/$131 (max travel) fill the shared
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

export function computeCncDetectedApply(
  detected: ControllerSettingsSnapshot,
  machine: CncMachineConfig,
  device: BedDims,
): CncDetectedApply | null {
  // On a hybrid machine $30 is laser PWM scale while $32=1, not spindle RPM.
  // Offer it as a CNC spindle ceiling only when the controller itself reports
  // CNC mode; otherwise applying a laser $30=1000 would invent a 1000 RPM cap.
  const spindleMaxRpm =
    detected.laserModeEnabled === false
      ? pickChanged(detected.maxPowerS, machine.params.spindleMaxRpm)
      : undefined;
  const bedWidth = pickChanged(detected.bedWidth, device.bedWidth);
  const bedHeight = pickChanged(detected.bedHeight, device.bedHeight);
  const paramsPatch = spindleMaxRpm === undefined ? {} : { spindleMaxRpm };
  const devicePatch = {
    ...(bedWidth === undefined ? {} : { bedWidth }),
    ...(bedHeight === undefined ? {} : { bedHeight }),
  };
  const summary = [
    ...(spindleMaxRpm === undefined ? [] : [`spindle max ${spindleMaxRpm} RPM`]),
    ...bedSummary(bedWidth, bedHeight),
  ].join(', ');
  if (summary === '') return null;
  return { paramsPatch, devicePatch, summary };
}

// A detected value worth offering: present AND different from the current one.
function pickChanged(detectedValue: number | undefined, current: number): number | undefined {
  return detectedValue !== undefined && detectedValue !== current ? detectedValue : undefined;
}

function bedSummary(bedWidth: number | undefined, bedHeight: number | undefined): string[] {
  if (bedWidth !== undefined && bedHeight !== undefined) return [`bed ${bedWidth}×${bedHeight} mm`];
  if (bedWidth !== undefined) return [`bed width ${bedWidth} mm`];
  if (bedHeight !== undefined) return [`bed height ${bedHeight} mm`];
  return [];
}
