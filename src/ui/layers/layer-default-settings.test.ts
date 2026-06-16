import { describe, expect, it } from 'vitest';
import { createLayer } from '../../core/scene';
import {
  applyLayerDefaultSettings,
  captureLayerDefaultSettings,
  layerDefaultsStorageKey,
} from './layer-default-settings';

describe('layer default settings helpers', () => {
  it('captures backed settings without id or color', () => {
    const layer = {
      ...createLayer({ id: '#ff0000', color: '#ff0000', mode: 'fill' }),
      power: 44,
    };

    const captured = captureLayerDefaultSettings(layer);

    expect(captured).toMatchObject({ mode: 'fill', power: 44 });
    expect(captured).not.toHaveProperty('id');
    expect(captured).not.toHaveProperty('color');
  });

  it('applies defaults while preserving layer identity', () => {
    const layer = createLayer({ id: '#00ff00', color: '#00ff00' });

    const applied = applyLayerDefaultSettings(layer, {
      mode: 'image',
      power: 12,
      speed: 987,
    });

    expect(applied).toMatchObject({
      id: '#00ff00',
      color: '#00ff00',
      mode: 'image',
      power: 12,
      speed: 987,
    });
  });

  it('keys defaults by device profile name', () => {
    expect(layerDefaultsStorageKey('GRBL4040')).toBe('laserforge.layer-defaults.v1.GRBL4040');
  });
});
