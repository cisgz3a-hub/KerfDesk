// rotary-summary — one wording for a rotary setup wherever KerfDesk names it:
// the Rotary switch beside Frame/Start, the Machine Setup status line and the
// Job Review machine facts (ADR-373), so all three describe the same thing.

import {
  rotaryMeasurementsValid,
  rotaryUsesRollerDiameter,
  rotaryYLimitMm,
  rotaryYScale,
  type RotarySetup,
} from '../../core/devices/rotary';

export function rotaryTypeLabel(setup: RotarySetup): string {
  return setup.type === 'roller' ? 'Roller' : 'Chuck';
}

/** "Chuck, Ø60 mm", plus the roller size when Y is scaled from it. */
export function rotaryAttachmentSummary(setup: RotarySetup): string {
  const summary = `${rotaryTypeLabel(setup)}, Ø${formatRotaryMm(setup.objectDiameterMm)} mm`;
  if (!rotaryUsesRollerDiameter(setup) || setup.rollerDiameterMm === undefined) return summary;
  return `${summary} (rollers Ø${formatRotaryMm(setup.rollerDiameterMm)} mm)`;
}

/** "Y ×1.91, one revolution = 360 machine mm": the scale and the wrap limit. */
export function rotaryMappingSummary(setup: RotarySetup): string {
  const scale = rotaryYScale(setup).toFixed(2);
  return `Y ×${scale}, one revolution = ${formatRotaryMm(rotaryYLimitMm(setup))} machine mm`;
}

/** The Job Review machine fact: what the next job's Y mapping will be. */
export function rotaryReviewSummary(setup: RotarySetup): string {
  if (!setup.enabled) return 'Configured, disabled';
  if (!rotaryMeasurementsValid(setup))
    return 'Enabled, but its measurements are unusable: not applied';
  return `Enabled · ${rotaryAttachmentSummary(setup)} · ${rotaryMappingSummary(setup)}`;
}

// At most two decimals and no trailing zeros: 60 → "60", 188.4956 → "188.5".
export function formatRotaryMm(value: number): string {
  return String(Number(value.toFixed(2)));
}
