import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  createLayer,
  createProject,
  type Layer,
} from '../../core/scene';
import { layerWithCncMaterial } from './cnc-project-material';
import { cncStartupOperationDraft, sceneWithCncStartupOperationDrafts } from './cnc-startup-setup';

function cncLayer(id: string): Layer {
  return { ...createLayer({ id, color: id }), cnc: { ...DEFAULT_CNC_LAYER_SETTINGS } };
}

function materialLayer(id: string): Layer {
  return layerWithCncMaterial({
    layer: cncLayer(id),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    profile: DEFAULT_DEVICE_PROFILE,
    materialKey: 'hardwood',
  });
}

function apply(layer: Layer, draft = cncStartupOperationDraft(layer)): Layer {
  const base = createProject().scene;
  const scene = sceneWithCncStartupOperationDrafts({
    scene: { ...base, layers: [layer] },
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    profile: DEFAULT_DEVICE_PROFILE,
    liveCaps: null,
    drafts: [draft],
  });
  const result = scene.layers[0];
  if (result === undefined) throw new Error('Expected the CNC test layer.');
  return result;
}

describe('CNC Startup Setup operation drafts', () => {
  it('is reference-stable when no setup-owned binding changed', () => {
    const layer = materialLayer('#aa0000');
    expect(apply(layer)).toBe(layer);
  });

  it('creates settings when Tool Plan changes a valid CNC layer with no stored cnc block', () => {
    const layer = createLayer({ id: 'unseeded', color: '#aa0000' });
    expect(layer.cnc).toBeUndefined();
    const result = apply(layer, {
      ...cncStartupOperationDraft(layer),
      materialKey: 'hardwood',
      toolId: 'em-6350',
    });

    expect(result.cnc).toMatchObject({
      materialKey: 'hardwood',
      toolId: 'em-6350',
      feedSource: { kind: 'material-recipe', materialKey: 'hardwood' },
    });
  });

  it('recalculates material-derived values when the operation bit changes', () => {
    const layer = materialLayer('#aa0000');
    const beforeFeed = layer.cnc?.feedMmPerMin;
    const result = apply(layer, {
      ...cncStartupOperationDraft(layer),
      toolId: 'em-6350',
    });

    expect(result.cnc).toMatchObject({
      toolId: 'em-6350',
      materialKey: 'hardwood',
      feedSource: { kind: 'material-recipe', materialKey: 'hardwood' },
    });
    expect(result.cnc?.feedMmPerMin).not.toBe(beforeFeed);
  });

  it('switches to manual provenance without changing numeric values', () => {
    const layer = materialLayer('#aa0000');
    const result = apply(layer, {
      ...cncStartupOperationDraft(layer),
      materialKey: null,
    });

    expect(result.cnc?.materialKey).toBeUndefined();
    expect(result.cnc?.feedSource).toBeUndefined();
    expect(result.cnc?.feedMmPerMin).toBe(layer.cnc?.feedMmPerMin);
    expect(result.cnc?.plungeMmPerMin).toBe(layer.cnc?.plungeMmPerMin);
    expect(result.cnc?.spindleRpm).toBe(layer.cnc?.spindleRpm);
  });

  it('preserves manual numbers when the operation bit changes', () => {
    const layer = {
      ...cncLayer('#aa0000'),
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        materialKey: 'hardwood',
        feedMmPerMin: 731,
        plungeMmPerMin: 219,
      },
    };
    const result = apply(layer, {
      ...cncStartupOperationDraft(layer),
      toolId: 'em-6350',
    });

    expect(result.cnc).toMatchObject({
      toolId: 'em-6350',
      feedMmPerMin: 731,
      plungeMmPerMin: 219,
    });
    expect(result.cnc?.materialKey).toBe('hardwood');
    expect(result.cnc?.feedSource).toBeUndefined();
  });

  it('moves all specialist tool bindings without altering cutting values', () => {
    const layer = cncLayer('#aa0000');
    const result = apply(layer, {
      ...cncStartupOperationDraft(layer),
      vClearToolId: 'em-6350',
      pocketRoughToolId: 'em-9525',
      reliefFinishToolId: 'bn-3175',
    });

    expect(result.cnc).toMatchObject({
      vClearToolId: 'em-6350',
      pocketRoughToolId: 'em-9525',
      reliefFinishToolId: 'bn-3175',
      depthMm: layer.cnc?.depthMm,
      feedMmPerMin: layer.cnc?.feedMmPerMin,
    });
  });
});
