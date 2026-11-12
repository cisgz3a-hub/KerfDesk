// The unit a status report gives a rotary axis in (Oracle audit O1, O12-P1-1).
//
// With `$13=1` (report inches), grblHAL divides every reported axis by 25.4
// except an axis past Z that `$376` marks as rotary (grblHAL core report.c,
// the `idx > Z_AXIS && is_rotary` branch beside `INCH_PER_MM`). The Falcon A1
// Pro ships `$376=0`, so its A turn reads 25.4 times too small under `$13=1`.
// Stock GRBL has no A axis and does not list `$376`. FluidNC never converts
// A-C (Report.cpp, `is_linear` in Types.h) and does not list `$376` either.
// So A is scaled only when the controller listed `$376` with the A bit clear.
// Z, the stock-GRBL rotary, is always a linear axis and always converted.

import type { ControllerSettingsSnapshot } from './parse-settings';

const MM_PER_INCH = 25.4;
// grblHAL axis masks: X = bit 0, Y = bit 1, Z = bit 2, A = bit 3.
const A_AXIS_BIT = 1 << 3;

/** grblHAL `$376` "Rotary axes" mask, when the `$$` dump listed it. */
export function rotaryAxesMaskField(
  map: ReadonlyMap<number, string>,
): Pick<ControllerSettingsSnapshot, 'rotaryAxesMask'> {
  const raw = map.get(376)?.trim();
  if (raw === undefined || !/^\d+$/.test(raw)) return {};
  return { rotaryAxesMask: Number.parseInt(raw, 10) };
}

/** The factor that turns a reported A or Z position into degrees (A) or
 *  millimetres (Z), the units every rotary command KerfDesk sends uses. */
export function reportedTurnScale(
  settings: Pick<ControllerSettingsSnapshot, 'reportInches' | 'rotaryAxesMask'> | null | undefined,
  axis: 'A' | 'Z',
): number {
  if (settings?.reportInches !== true) return 1;
  if (axis === 'Z') return MM_PER_INCH;
  const mask = settings.rotaryAxesMask;
  return mask !== undefined && (mask & A_AXIS_BIT) === 0 ? MM_PER_INCH : 1;
}
