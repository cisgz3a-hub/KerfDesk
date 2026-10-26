// grblHAL's `$10` is a bitfield whose bit 0 picks MPos over WPos and whose
// bits 5 and 6 send WCO: and Ov: (core settings.h#L655-L675,
// report.c#L1331-L1340, #L1471-L1507); its default is 511. Stock GRBL's `$10`
// has no such bits. Controller audit v2 C8-P2-2, ADR-375 Amendment 2.

import { describe, expect, it } from 'vitest';
import { fluidncDriver, grblDriver, grblHalDriver } from '..';
import { statusReportFieldsOff } from './status-report-mask';

const whole = (mask: number) => ({ statusReportMask: mask, statusReportMaskIsFull: true as const });

describe('statusReportFieldsOff', () => {
  it('reads LightBurn-advised $10=0 as WPos without WCO or Ov: no machine position', () => {
    expect(statusReportFieldsOff(grblHalDriver.capabilities, whole(0))).toEqual({
      mask: 0,
      workOffsetOff: true,
      overridesOff: true,
      machinePositionUnknown: true,
      suggestedMask: 96,
    });
  });

  it('reads a stock-GRBL $10=1 as MPos without WCO or Ov', () => {
    expect(statusReportFieldsOff(grblHalDriver.capabilities, whole(1))).toEqual({
      mask: 1,
      workOffsetOff: true,
      overridesOff: true,
      machinePositionUnknown: false,
      suggestedMask: 97,
    });
  });

  it('finds nothing off at the grblHAL default, 511', () => {
    expect(statusReportFieldsOff(grblHalDriver.capabilities, whole(511))).toBeNull();
  });

  it('names one field when only one bit is clear, keeping the other bits', () => {
    expect(statusReportFieldsOff(grblHalDriver.capabilities, whole(511 - 64))).toMatchObject({
      workOffsetOff: false,
      overridesOff: true,
      machinePositionUnknown: false,
      suggestedMask: 511,
    });
    expect(statusReportFieldsOff(grblHalDriver.capabilities, whole(2 + 64))).toMatchObject({
      workOffsetOff: true,
      overridesOff: false,
      machinePositionUnknown: true,
      suggestedMask: 98,
    });
  });

  it('claims nothing when $10 was not shown whole or the firmware is not grblHAL', () => {
    expect(statusReportFieldsOff(grblHalDriver.capabilities, { statusReportMask: 1 })).toBeNull();
    expect(statusReportFieldsOff(grblHalDriver.capabilities, null)).toBeNull();
    expect(statusReportFieldsOff(grblDriver.capabilities, whole(0))).toBeNull();
    expect(statusReportFieldsOff(fluidncDriver.capabilities, whole(0))).toBeNull();
  });

  // Meta audit v1 M3-P3-3 (ADR-375 Amendment 4): Ortur's ESP32-S2 grblHAL
  // firmware (level 1, "Grbl 1.1f", no preset) runs under the stock-GRBL
  // profile; its `$10` has the same bits (settings.h#L331-L338) and gates
  // WCO: and Ov: on bits 5 and 6 (report.c#L1401-L1412).
  it("reads grblHAL's $10 on the stock-GRBL profile when the $$ lists grblHAL's $14-$18", () => {
    const grblHalDump = { ...whole(1), listsGrblHalSignalSettings: true as const };
    expect(statusReportFieldsOff(grblDriver.capabilities, grblHalDump)).toMatchObject({
      workOffsetOff: true,
      overridesOff: true,
      suggestedMask: 97,
    });
    expect(statusReportFieldsOff(fluidncDriver.capabilities, grblHalDump)).toBeNull();
    // A stock fork's own extra settings (Ortur's STM32 `$33`) are not grblHAL's.
    expect(statusReportFieldsOff(grblDriver.capabilities, whole(1))).toBeNull();
  });
});
