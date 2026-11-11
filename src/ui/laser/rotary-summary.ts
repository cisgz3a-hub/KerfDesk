// rotary-summary — one wording for a rotary setup wherever KerfDesk names it:
// the Rotary switch beside Frame/Start, the Machine Setup status line and the
// Job Review machine facts (ADR-373), so all three describe the same thing.

import {
  activeRotaryTaper,
  rotaryMeasurementsValid,
  rotaryUsesRollerDiameter,
  rotaryYLimitMm,
  rotaryYScale,
  type RotarySetup,
} from '../../core/devices/rotary';
import { rotaryAxisOf, rotaryAxisUnitLabel } from '../../core/devices/rotary-axis';
import { formatUpTo2Decimals } from '../../core/util/number-format';

export function rotaryTypeLabel(setup: RotarySetup): string {
  return setup.type === 'roller' ? 'Roller' : 'Chuck';
}

/**
 * "Chuck, Ø60 mm", plus what a roller's Y follows: the roller size when Y is
 * scaled from it, or "Y not scaled" for a controller set to the surface
 * (ADR-373 Amendment 1), so the switch and Job Review name the mode.
 */
export function rotaryAttachmentSummary(setup: RotarySetup): string {
  const summary = `${rotaryTypeLabel(setup)}, ${rotaryObjectSummary(setup)}`;
  if (setup.type === 'chuck') return summary;
  if (!rotaryUsesRollerDiameter(setup) || setup.rollerDiameterMm === undefined) {
    return `${summary} (Y not scaled)`;
  }
  return `${summary} (rollers Ø${formatUpTo2Decimals(setup.rollerDiameterMm)} mm)`;
}

/** "Y ×1.91, one revolution = 360 machine mm": the axis, its scale and the
 * wrap limit, in the axis's own units ("A ×1.43, one revolution = 360°" on a
 * degree-counting A axis, ADR-695). */
export function rotaryMappingSummary(setup: RotarySetup): string {
  const axis = rotaryAxisOf(setup);
  const scale = rotaryYScale(setup).toFixed(2);
  const turn = formatUpTo2Decimals(rotaryYLimitMm(setup));
  const unit = rotaryAxisUnitLabel(axis);
  return `${axis} ×${scale}, one revolution = ${turn}${unit === '°' ? '°' : ` ${unit}`}`;
}

/** The Job Review machine fact: what the next job's Y mapping will be. */
export function rotaryReviewSummary(setup: RotarySetup): string {
  if (!setup.enabled) return 'Configured, disabled';
  if (!rotaryMeasurementsValid(setup))
    return 'Enabled, but its measurements are unusable: not applied';
  // ADR-127 Amd 2: a scaled Y gets matched feeds, so the layer speed holds on
  // the part's surface in every direction (rolling audit v12 X8-P1-1).
  const matched = rotaryYScale(setup) !== 1 || activeRotaryTaper(setup) !== null;
  const speed = matched ? " · each move's feed holds the layer speed on the part" : '';
  return `Enabled · ${rotaryAttachmentSummary(setup)} · ${rotaryMappingSummary(setup)}${speed}`;
}

// "Ø60 mm", or a taper's ends and length (ADR-694): "taper Ø80 → Ø70 mm over 100 mm".
function rotaryObjectSummary(setup: RotarySetup): string {
  const taper = activeRotaryTaper(setup);
  if (taper === null) return `Ø${formatUpTo2Decimals(setup.objectDiameterMm)} mm`;
  const top = formatUpTo2Decimals(taper.topDiameterMm);
  const bottom = formatUpTo2Decimals(taper.bottomDiameterMm);
  return `taper Ø${top} → Ø${bottom} mm over ${formatUpTo2Decimals(taper.lengthMm)} mm`;
}

export { formatUpTo2Decimals as formatRotaryMm } from '../../core/util/number-format';
