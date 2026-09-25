import { describe, expect, it } from 'vitest';
import { createLayer, type Layer } from '../../core/scene';
import { readCutSettingsPatch } from './cut-settings-draft';
import { readLineCutOptionsPatch } from './cut-settings-line-options';

function formData(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

function lineLayer(patch: Partial<Layer> = {}): Layer {
  return { ...createLayer({ id: 'cut', color: '#ff0000' }), ...patch };
}

// What the dialog submits for a Line operation nobody touched.
const UNTOUCHED = {
  visible: 'on',
  output: 'on',
  tabSkipInnerShapes: 'on',
  overcutMm: '0',
  tabPlacement: 'per-shape',
};

describe('Line option draft', () => {
  it('adds nothing when the fields still show the defaults', () => {
    const patch = readCutSettingsPatch(
      formData({ mode: 'line', power: '30', speed: '1500', passes: '1', ...UNTOUCHED }),
      lineLayer(),
    );
    const applied = JSON.parse(JSON.stringify({ ...lineLayer(), ...patch })) as Layer;
    expect(applied).toEqual(JSON.parse(JSON.stringify(lineLayer())));
  });

  it('reads an overcut and clamps it to the supported range', () => {
    const layer = lineLayer();
    expect(readLineCutOptionsPatch(formData({ overcutMm: '1.5' }), layer, 'line').overcutMm).toBe(
      1.5,
    );
    expect(readLineCutOptionsPatch(formData({ overcutMm: '80' }), layer, 'line').overcutMm).toBe(
      50,
    );
    expect(
      readLineCutOptionsPatch(formData({ overcutMm: '-2' }), layer, 'line').overcutMm,
    ).toBeUndefined();
  });

  it('writes an explicit 0 only to switch an existing overcut off', () => {
    const layer = lineLayer({ overcutMm: 2 });
    expect(readLineCutOptionsPatch(formData({ overcutMm: '0' }), layer, 'line').overcutMm).toBe(0);
    expect(readLineCutOptionsPatch(formData({ overcutMm: '2' }), layer, 'line').overcutMm).toBe(2);
  });

  it('reads spacing placement with whole-number limits', () => {
    const patch = readLineCutOptionsPatch(
      formData({
        tabPlacement: 'spacing',
        tabSpacingMm: '0.2',
        tabMinPerShape: '2.7',
        tabMaxPerShape: '60.9',
      }),
      lineLayer(),
      'line',
    );
    expect(patch).toEqual({
      tabPlacement: 'spacing',
      tabSpacingMm: 1,
      tabMinPerShape: 2,
      tabMaxPerShape: 60,
    });
  });

  it('keeps stored spacing values while their fields are hidden', () => {
    const layer = lineLayer({ tabPlacement: 'spacing', tabSpacingMm: 30, tabMaxPerShape: 8 });
    const patch = readLineCutOptionsPatch(formData({ tabPlacement: 'per-shape' }), layer, 'line');
    expect(patch).toMatchObject({
      tabPlacement: 'per-shape',
      tabSpacingMm: 30,
      tabMaxPerShape: 8,
    });
  });

  it('leaves every option alone outside Line mode', () => {
    const layer = lineLayer({ overcutMm: 3, tabPlacement: 'spacing', tabSpacingMm: 40 });
    const patch = readLineCutOptionsPatch(
      formData({ overcutMm: '9', tabPlacement: 'per-shape', tabSpacingMm: '5' }),
      layer,
      'fill',
    );
    expect(patch).toMatchObject({ overcutMm: 3, tabPlacement: 'spacing', tabSpacingMm: 40 });
  });
});
