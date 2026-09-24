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
      airAssist: true,
      power: 44,
    };

    const captured = captureLayerDefaultSettings(layer);

    expect(captured).toMatchObject({ airAssist: true, mode: 'fill', power: 44 });
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

  it('never carries a calibration-coupon marker into new layers', () => {
    const calibration = {
      ...createLayer({ id: '#0000ff', color: '#0000ff', mode: 'fill' }),
      scanOffsetCalibrationMode: 'baseline' as const,
      bindingOperationId: 'op-1',
      power: 21,
    };

    const captured = captureLayerDefaultSettings(calibration);
    expect(captured).toMatchObject({ power: 21 });
    expect(captured).not.toHaveProperty('scanOffsetCalibrationMode');
    expect(captured).not.toHaveProperty('bindingOperationId');

    // A default saved before this rule still holds the marker; it must not apply.
    const applied = applyLayerDefaultSettings(createLayer({ id: '#00ff00', color: '#00ff00' }), {
      power: 21,
      scanOffsetCalibrationMode: 'baseline',
      bindingOperationId: 'op-1',
    });
    expect(applied).toMatchObject({ power: 21 });
    expect(applied).not.toHaveProperty('scanOffsetCalibrationMode');
    expect(applied).not.toHaveProperty('bindingOperationId');
  });

  it('keys defaults by device profile name', () => {
    expect(layerDefaultsStorageKey('GRBL4040')).toBe('laserforge.layer-defaults.v1.GRBL4040');
  });
});
