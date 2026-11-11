import { describe, expect, it } from 'vitest';
import { createLayer, type Layer } from '../../core/scene';
import { readCutSettingsPatch } from './cut-settings-draft';

function fillLayer(settings: Partial<Layer> = {}): Layer {
  return { ...createLayer({ id: 'F', color: '#0000ff', mode: 'fill' }), power: 60, ...settings };
}

function fillForm(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    mode: 'fill',
    power: '60',
    speed: '1500',
    passes: '1',
    fillStyle: 'scanline',
    ...fields,
  }))
    data.set(key, value);
  return data;
}

describe('Cut Settings Fill Ramp (ADR-699)', () => {
  it('writes no ramp keys when the Ramp fields are left alone', () => {
    const patch = readCutSettingsPatch(
      fillForm({ fillRampShown: '1', fillRampLengthMm: '0', fillRampMinPower: '0' }),
      fillLayer(),
    );
    expect('fillRampLengthMm' in patch).toBe(false);
    expect('fillRampOuterEdge' in patch).toBe(false);
    expect(patch.minPower).toBe(0);
  });

  it('reads the ramp length, its min power and the outer edge switch', () => {
    const patch = readCutSettingsPatch(
      fillForm({
        fillRampShown: '1',
        fillRampLengthMm: '1.5',
        fillRampMinPower: '12',
        fillRampOuterEdge: 'on',
      }),
      fillLayer(),
    );
    expect(patch).toMatchObject({ fillRampLengthMm: 1.5, fillRampOuterEdge: true, minPower: 12 });
  });

  it('keeps Ramp min power at or under Power', () => {
    const patch = readCutSettingsPatch(
      fillForm({ fillRampShown: '1', fillRampLengthMm: '2', fillRampMinPower: '90' }),
      fillLayer(),
    );
    expect(patch.minPower).toBe(60);
  });

  it('leaves a stored ramp alone when the form does not show the Ramp fields', () => {
    const layer = fillLayer({ fillRampLengthMm: 2, fillRampOuterEdge: true, minPower: 15 });
    const patch = readCutSettingsPatch(fillForm({}), layer);
    expect('fillRampLengthMm' in patch).toBe(false);
    expect('fillRampOuterEdge' in patch).toBe(false);
    expect(patch.minPower).toBe(15);
  });
});
