import { describe, expect, it } from 'vitest';
import { linesPerMmToLineIntervalMm } from '../../core/raster/raster-units';
import { createLayer, type Layer } from '../../core/scene';
import { dotWidthCorrectionMax, readCutSettingsPatch } from './cut-settings-draft';

describe('cut settings draft helpers', () => {
  it('clamps common power, min power, speed, and pass values', () => {
    const layer = imageLayer({ minPower: 5, power: 30, passes: 1 });
    const patch = readCutSettingsPatch(
      formData({
        mode: 'image',
        power: '42',
        minPower: '99',
        speed: '-50',
        passes: '2.9',
        visible: 'on',
        output: 'on',
      }),
      layer,
    );

    expect(patch.power).toBe(42);
    expect(patch.minPower).toBe(42);
    expect(patch.speed).toBe(1);
    expect(patch.passes).toBe(2);
  });

  it('reads air assist checkbox from the shared cut settings form', () => {
    const layer = createLayer({ id: 'L1', color: '#000000' });
    const patch = readCutSettingsPatch(
      formData({
        mode: 'line',
        power: '30',
        speed: '1500',
        passes: '1',
        visible: 'on',
        output: 'on',
        airAssist: 'on',
      }),
      layer,
    );

    expect(patch.airAssist).toBe(true);
  });

  it('maps fill line interval and lines-per-inch values to hatch spacing', () => {
    const layer = fillLayer({ hatchSpacingMm: 0.2 });

    expect(
      readCutSettingsPatch(formData({ mode: 'fill', hatchSpacingMm: '0.25' }), layer)
        .hatchSpacingMm,
    ).toBe(0.25);
    expect(
      readCutSettingsPatch(formData({ mode: 'fill', fillLinesPerInch: '254' }), layer)
        .hatchSpacingMm,
    ).toBeCloseTo(0.1, 8);
  });

  it('maps image DPI and line interval values to lines per mm', () => {
    const layer = imageLayer({ linesPerMm: 10 });

    expect(
      readCutSettingsPatch(formData({ mode: 'image', imageDpi: '508' }), layer).linesPerMm,
    ).toBe(20);
    expect(
      readCutSettingsPatch(formData({ mode: 'image', lineIntervalMm: '0.2' }), layer).linesPerMm,
    ).toBe(5);
  });

  it('clamps dot width correction to one raster line interval', () => {
    const layer = imageLayer({ linesPerMm: 10, dotWidthCorrectionMm: 0 });
    const patch = readCutSettingsPatch(
      formData({
        mode: 'image',
        imageDpi: '254',
        dotWidthCorrectionMm: '99',
      }),
      layer,
    );

    expect(dotWidthCorrectionMax(10)).toBe(0.1);
    expect(patch.dotWidthCorrectionMm).toBeCloseTo(linesPerMmToLineIntervalMm(10), 8);
  });
});

function formData(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

function fillLayer(patch: Partial<Layer> = {}): Layer {
  return { ...createLayer({ id: '#ff0000', color: '#ff0000', mode: 'fill' }), ...patch };
}

function imageLayer(patch: Partial<Layer> = {}): Layer {
  return { ...createLayer({ id: '#808080', color: '#808080', mode: 'image' }), ...patch };
}
