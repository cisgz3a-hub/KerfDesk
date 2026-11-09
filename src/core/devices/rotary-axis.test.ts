import { describe, expect, it } from 'vitest';
import { FALCON_A1_PRO_BUILD_INFO } from '../../__fixtures__/controllers/falcon-a1-pro-dump';
import { parseFirmwareReport } from '../controllers/controller-firmware-report';
import { FALCON_A1_PRO_GRBLHAL_PROFILE, FALCON_COMPATIBLE_PROFILE } from './falcon-profiles';
import {
  axisLettersFromAxsField,
  rotaryAxesForController,
  rotaryAxisNeedsConfirmation,
  rotaryAxisOf,
  rotaryAxisReportVerdict,
} from './rotary-axis';
import { ROTARY_PRESETS, rotaryPresetsFor } from './rotary-presets';

describe('rotary axis (ADR-693)', () => {
  it('is Y for every setup saved before it', () => {
    expect(rotaryAxisOf({})).toBe('Y');
    expect(rotaryAxisOf(undefined)).toBe('Y');
    expect(rotaryAxisOf({ axis: 'A' })).toBe('A');
  });

  it('offers A only where the controller can have a fourth axis', () => {
    expect(rotaryAxesForController({ controllerKind: 'grblhal' })).toEqual(['Y', 'A', 'Z']);
    expect(rotaryAxesForController({ controllerKind: 'fluidnc' })).toEqual(['Y', 'A', 'Z']);
    expect(rotaryAxesForController({ controllerKind: 'grbl-v1.1' })).toEqual(['Y', 'Z']);
    expect(rotaryAxesForController({})).toEqual(['Y', 'Z']);
    for (const kind of ['marlin', 'smoothieware', 'ruida'] as const) {
      expect(rotaryAxesForController({ controllerKind: kind })).toEqual(['Y']);
    }
  });

  it('wants one confirmed Test rotation on a dedicated axis, never on Y', () => {
    expect(rotaryAxisNeedsConfirmation({})).toBe(false);
    expect(rotaryAxisNeedsConfirmation({ axis: 'A' })).toBe(true);
    expect(rotaryAxisNeedsConfirmation({ axis: 'A', axisConfirmed: 'A' })).toBe(false);
    expect(rotaryAxisNeedsConfirmation({ axis: 'Z', axisConfirmed: 'A' })).toBe(true);
  });

  it("reads the A1 Pro's published $I as having an A axis", () => {
    const report = parseFirmwareReport('grblhal', FALCON_A1_PRO_BUILD_INFO);
    const axs = report.fields.find((field) => field.name === 'AXS')?.value;
    const letters = axisLettersFromAxsField(axs);
    expect(letters).toBe('XYZA');
    expect(rotaryAxisReportVerdict('A', { statusAxisCount: null, axisLetters: letters })).toBe(
      'present',
    );
    expect(rotaryAxisReportVerdict('A', { statusAxisCount: 4, axisLetters: 'XYZ' })).toBe(
      'missing',
    );
  });

  it('falls back to the status report axis count', () => {
    expect(rotaryAxisReportVerdict('A', { statusAxisCount: 3 })).toBe('missing');
    expect(rotaryAxisReportVerdict('A', { statusAxisCount: 4 })).toBe('present');
    expect(rotaryAxisReportVerdict('Z', { statusAxisCount: 3 })).toBe('present');
    expect(rotaryAxisReportVerdict('A', { statusAxisCount: null })).toBe('unknown');
  });
});

describe('rotary presets (ADR-503, ADR-693)', () => {
  it('cites a source for every preset and names its port', () => {
    for (const preset of ROTARY_PRESETS) {
      expect(preset.source).toMatch(/https:\/\//);
      expect(preset.setup.axis).toBeDefined();
    }
  });

  it('never offers the A1 Pro the Y-port figure, and offers it the A connector', () => {
    const a1Pro = rotaryPresetsFor(FALCON_A1_PRO_GRBLHAL_PROFILE).map((preset) => preset.id);
    expect(a1Pro).toEqual(['creality-rotary-kit-pro-chuck-a1-pro']);
    const yPort = rotaryPresetsFor(FALCON_COMPATIBLE_PROFILE).map((preset) => preset.id);
    expect(yPort).toEqual(['creality-rotary-kit-pro-chuck']);
  });

  it("carries xTool's published RA2 Pro figures", () => {
    const xtool = rotaryPresetsFor({ machineFamily: 'xtool-d1-pro' });
    expect(xtool.map((preset) => preset.setup)).toEqual([
      { type: 'chuck', axis: 'Y', mmPerRotation: 128 },
      { type: 'roller', axis: 'Y', mmPerRotation: 32, roller: { diameterMm: 17 } },
    ]);
  });
});
