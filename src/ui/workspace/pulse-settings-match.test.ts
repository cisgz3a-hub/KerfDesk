import { describe, expect, it } from 'vitest';
import { captureLayerOperationSettings, createLayer, type Layer } from '../../core/scene';
import { sameOperationSettings } from './pulse-settings-match';

function layer(id: string, overrides: Partial<Layer> = {}): Layer {
  return { ...createLayer({ id, color: '#2563eb' }), ...overrides };
}

describe('sameOperationSettings (ADR-620)', () => {
  it('treats a missing optional laser setting as the value output uses', () => {
    const legacy = layer('legacy');
    const saved = layer('saved', {
      perforationEnabled: false,
      tabLayout: 'count',
      autoOverscan: false,
      powerMode: 'auto',
      overcutMm: 0,
    });
    expect(sameOperationSettings(legacy, saved, 'laser')).toBe(true);
    expect(
      sameOperationSettings(legacy, layer('perf', { perforationEnabled: true }), 'laser'),
    ).toBe(false);
  });

  it('ignores sub-operation ids and labels but not their settings', () => {
    const settings = captureLayerOperationSettings(layer('base'));
    const a = layer('a', { subLayers: [{ id: 'sub-1', label: 'Score', enabled: true, settings }] });
    const b = layer('b', {
      subLayers: [{ id: 'sub-7', label: 'Pass 2', enabled: true, settings }],
    });
    expect(sameOperationSettings(a, b, 'laser')).toBe(true);
    const hotter = layer('c', {
      subLayers: [
        { id: 'sub-1', label: 'Score', enabled: true, settings: { ...settings, power: 90 } },
      ],
    });
    expect(sameOperationSettings(a, hotter, 'laser')).toBe(false);
    const off = layer('d', {
      subLayers: [{ id: 'sub-1', label: 'Score', enabled: false, settings }],
    });
    expect(sameOperationSettings(a, off, 'laser')).toBe(false);
  });
});
