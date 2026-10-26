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
//
// A stock-GRBL profile reads `$10` this way too when its `$$` lists grblHAL's
// `$14`-`$18`. Ortur's ESP32-S2 grblHAL firmware (COMPATIBILITY_LEVEL 1, no
// KerfDesk preset) greets as "Grbl 1.1f", prints `$10` whole and sends WCO: and
// Ov: only with bits 5 and 6 (meta audit v1 M3-P3-3, ADR-375 Amendment 5).
// https://github.com/Ortur-Tech/Ortur_Laser_Firmware_17X-18X/blob/4849ac85fc1f1a15c47d0dbbfc3e69450922ad32/ESPLaserMasterGrbl/main/grbl/settings.h#L331-L338
// https://github.com/Ortur-Tech/Ortur_Laser_Firmware_17X-18X/blob/4849ac85fc1f1a15c47d0dbbfc3e69450922ad32/ESPLaserMasterGrbl/main/grbl/report.c#L1401-L1412

import type { ControllerCapabilities } from '../controller-capabilities';
import type { ControllerSettingsSnapshot } from '../grbl/parse-settings';

type StatusReportMaskSettings = Pick<
  ControllerSettingsSnapshot,
  'statusReportMask' | 'statusReportMaskIsFull' | 'listsGrblHalSignalSettings'
>;

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
  settings: StatusReportMaskSettings | null,
): StatusReportFieldsOff | null {
  if (!readsGrblHalMask(capabilities, settings)) return null;
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
 * printed only under `settings.status_report.pin_state`. A stock-GRBL profile
 * whose `$$` lists grblHAL's `$14`-`$18` reads it too (ADR-375 Amendment 5).
 * https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/report.c#L1409-L1436 */
export function pinStateReportOff(
  capabilities: Pick<ControllerCapabilities, 'statusReportMask'>,
  settings: StatusReportMaskSettings | null,
): PinStateReportOff | null {
  if (!readsGrblHalMask(capabilities, settings)) return null;
  const mask = settings?.statusReportMask;
  if (settings?.statusReportMaskIsFull !== true || mask === undefined) return null;
  return (mask & PIN_STATE_BIT) === 0 ? { mask, suggestedMask: mask | PIN_STATE_BIT } : null;
}

function readsGrblHalMask(
  capabilities: Pick<ControllerCapabilities, 'statusReportMask'>,
  settings: StatusReportMaskSettings | null,
): boolean {
  if (capabilities.statusReportMask === 'grblhal-fields') return true;
  return (
    capabilities.statusReportMask === 'grblhal-fields-if-grblhal-dump' &&
    settings?.listsGrblHalSignalSettings === true
  );
}
