import { describe, expect, it } from 'vitest';
import { templateOperation } from '../../core/material-library/process-recipe-operation';
import {
  captureLayerOperationSettings,
  createLayer,
  IDENTITY_TRANSFORM,
  type Layer,
  type SceneObject,
} from '../../core/scene';
import { withoutLaserLeadSettings } from '../../core/scene/layer';
import { applyLayerDefaultSettings } from './layer-default-settings';

const LEADS: Partial<Layer> = {
  leadInEnabled: true,
  leadOutEnabled: true,
  leadStyle: 'line',
  leadLengthMm: 3,
  leadAngleDeg: 30,
  leadSide: 'inside',
};
const LEAD_KEYS = Object.keys(LEADS);

const ARTWORK: SceneObject = {
  kind: 'imported-svg',
  id: 'art',
  source: 'art.svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [],
};

describe('applying stored settings over an operation with leads (ADR-626)', () => {
  it('clears leads that the stored settings do not have', () => {
    const led: Layer = { ...createLayer({ id: 'cut', color: '#ff0000' }), ...LEADS };
    const plain = captureLayerOperationSettings(createLayer({ id: 'd', color: '#000000' }));
    const reset = applyLayerDefaultSettings(led, plain);
    for (const key of LEAD_KEYS) expect(reset).not.toHaveProperty(key);
    const recipe = templateOperation(
      { objects: [ARTWORK], layers: [led] },
      ARTWORK,
      {
        name: 'Cut',
        color: '#ff0000',
        output: true,
        visible: true,
        settings: plain,
      },
      led,
    );
    for (const key of LEAD_KEYS) expect(recipe).not.toHaveProperty(key);
  });

  it('keeps the leads that the stored settings do have', () => {
    const plain = createLayer({ id: 'cut', color: '#ff0000' });
    const stored = captureLayerOperationSettings({ ...plain, ...LEADS });
    expect(applyLayerDefaultSettings(plain, stored)).toMatchObject(LEADS);
    expect(withoutLaserLeadSettings(plain)).toBe(plain);
  });
});
