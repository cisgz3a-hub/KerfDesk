// grblHAL's `$10` status-report mask (controller audit v2 C8-P2-2, ADR-375
// Amendment 2). Stock GRBL's `$10` picks only MPos or WPos (bit 0) and the
// buffer field (bit 1), and its reports carry WCO: and Ov: whatever `$10`
// holds. grblHAL at COMPATIBILITY_LEVEL 0 (its default) or 1 stores `$10` whole
// as a bitfield (default 511), and its reports carry WCO: only with bit 5 and
// Ov: only with bit 6. A stock-GRBL value such as `$10=0` (LightBurn's advice
// for GRBL CNC lasers) or `$10=1` therefore turns both off for good, and
// `$10=0` reports WPos without the offset that would give the machine position.
// https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/settings.h#L655-L675
// https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/report.c#L1331-L1340
// https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/report.c#L1471-L1507
// https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/config.h#L97

import type { ControllerCapabilities } from '../controller-capabilities';
import type { ControllerSettingsSnapshot } from '../grbl/parse-settings';

const MACHINE_POSITION_BIT = 1 << 0;
const PIN_STATE_BIT = 1 << 4;
const WORK_OFFSET_BIT = 1 << 5;
const OVERRIDES_BIT = 1 << 6;

/** The report fields a whole grblHAL `$10` leaves off. */
export type StatusReportFieldsOff = {
  /** `$10` as the controller reported it. */
  readonly mask: number;
  /** Bit 5 is clear: no report carries WCO:. */
  readonly workOffsetOff: boolean;
  /** Bit 6 is clear: no report carries Ov:. */
  readonly overridesOff: boolean;
  /** Bit 0 and bit 5 are clear: reports carry WPos and no offset, so the
   * machine position cannot be known. */
  readonly machinePositionUnknown: boolean;
  /** `$10` with bits 5 and 6 set and every other bit kept. */
  readonly suggestedMask: number;
};

/** The WCO: and Ov: fields this controller's `$10` turns off, or null when it
 * sends both, is not grblHAL, or the `$$` did not show `$10` whole. */
export function statusReportFieldsOff(
  capabilities: Pick<ControllerCapabilities, 'statusReportMask'>,
  settings: Pick<ControllerSettingsSnapshot, 'statusReportMask' | 'statusReportMaskIsFull'> | null,
): StatusReportFieldsOff | null {
  if (capabilities.statusReportMask !== 'grblhal-fields') return null;
  const mask = settings?.statusReportMask;
  if (settings?.statusReportMaskIsFull !== true || mask === undefined) return null;
  const workOffsetOff = (mask & WORK_OFFSET_BIT) === 0;
  const overridesOff = (mask & OVERRIDES_BIT) === 0;
  if (!workOffsetOff && !overridesOff) return null;
  return {
    mask,
    workOffsetOff,
    overridesOff,
    machinePositionUnknown: workOffsetOff && (mask & MACHINE_POSITION_BIT) === 0,
    suggestedMask: mask | WORK_OFFSET_BIT | OVERRIDES_BIT,
  };
}

/** `$10` as reported, and the same with the pin-state bit set. */
export type PinStateReportOff = { readonly mask: number; readonly suggestedMask: number };

/** Whether this grblHAL's `$10` leaves Pn: out of every report (bit 4 clear),
 * so a closed probe input can never show; null when it does not, the
 * controller is not grblHAL, or the `$$` did not show `$10` whole. Pn: is
 * printed only under `settings.status_report.pin_state`:
 * https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/report.c#L1409-L1436 */
export function pinStateReportOff(
  capabilities: Pick<ControllerCapabilities, 'statusReportMask'>,
  settings: Pick<ControllerSettingsSnapshot, 'statusReportMask' | 'statusReportMaskIsFull'> | null,
): PinStateReportOff | null {
  if (capabilities.statusReportMask !== 'grblhal-fields') return null;
  const mask = settings?.statusReportMask;
  if (settings?.statusReportMaskIsFull !== true || mask === undefined) return null;
  return (mask & PIN_STATE_BIT) === 0 ? { mask, suggestedMask: mask | PIN_STATE_BIT } : null;
}
