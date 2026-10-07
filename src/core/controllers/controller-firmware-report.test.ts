import { describe, expect, it } from 'vitest';
import { selectControllerDriver } from './index';
import { firmwareReportQuery, parseFirmwareReport } from './controller-firmware-report';

describe('documented firmware report adapters', () => {
  it('uses family queries and leaves vendor overrides and file-only controllers unsupported', () => {
    expect(
      ['grbl-v1.1', 'grblhal', 'fluidnc', 'marlin', 'smoothieware', 'ruida'].map((kind) =>
        firmwareReportQuery(
          selectControllerDriver(kind as Parameters<typeof selectControllerDriver>[0]),
        ),
      ),
    ).toEqual(['$I', '$I+', '$I', 'M115', 'M115', null]);
    expect(
      firmwareReportQuery(selectControllerDriver('grbl-v1.1', 'creality-falcon-a1-pro')),
    ).toBeNull();
  });
  it('keeps family fields without persisting private build user strings', () => {
    const report = parseFirmwareReport('grblhal', [
      '[VER:1.1f.20261001:PRIVATE_UNIT]',
      '[OPT:V,35,1024,4,0]',
      '[AXS:4:XYZA]',
      '[FIRMWARE:grblHAL]',
      '[DRIVER:STM32]',
      '[NEWOPT:ENUMS,RT+]',
      'ok',
    ]);
    expect(report.fields).toContainEqual({ name: 'AXS', value: '4:XYZA' });
    expect(JSON.stringify(report)).not.toContain('PRIVATE_UNIT');
    expect(
      parseFirmwareReport('fluidnc', [
        '[VER:1.1f FluidNC v4.0 (ESP32):PRIVATE]',
        '[OPT:VL]',
        '[MSG:Machine:PRIVATE]',
        '[CLUSTER:16]',
      ]).fields,
    ).toContainEqual({ name: 'Reported options', value: 'VL' });
  });
  it('reads Marlin claims without turning them into app capabilities or keeping UUID', () => {
    const report = parseFirmwareReport('marlin', [
      'FIRMWARE_NAME:Marlin 2.1.2 SOURCE_CODE_URL:https://example.invalid PROTOCOL_VERSION:1.0 MACHINE_TYPE:Cartesian EXTRUDER_COUNT:1 UUID:PRIVATE',
      'Cap:Z_PROBE:1',
      'Cap:SDCARD:0',
      'ok',
    ]);
    expect(report.fields).toContainEqual({ name: 'FIRMWARE_NAME', value: 'Marlin 2.1.2' });
    expect(report.reportedCapabilities).toEqual([
      { name: 'Z_PROBE', enabled: true },
      { name: 'SDCARD', enabled: false },
    ]);
    expect(JSON.stringify(report)).not.toContain('PRIVATE');
  });
  it('recognises comma-separated Smoothie M115 independently', () => {
    expect(
      parseFirmwareReport('smoothieware', [
        'FIRMWARE_NAME:Smoothieware,FIRMWARE_VERSION:edge-123,PROTOCOL_VERSION:1.0,X-AXES:3,X-CNC:1',
        'ok',
      ]).fields,
    ).toContainEqual({ name: 'X-AXES', value: '3' });
  });
  it('rejects missing, conflicting and oversized identity exchanges', () => {
    expect(() => parseFirmwareReport('fluidnc', ['ok'])).toThrow('identity');
    expect(() => parseFirmwareReport('grblhal', ['[VER:one:]', '[VER:two:]'])).toThrow(
      'Conflicting',
    );
    expect(() => parseFirmwareReport('grbl-v1.1', ['x'.repeat(32769)])).toThrow('limit');
  });
});
