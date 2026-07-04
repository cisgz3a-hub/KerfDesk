import { describe, expect, it } from 'vitest';
import { calculateFeeds } from '../../core/cnc';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  createLayer,
  createProject,
  type Layer,
  type Project,
} from '../../core/scene';
import {
  layerWithCncMaterial,
  projectWithStockMaterial,
  seedLayerFromStockMaterial,
} from './cnc-project-material';

const MACHINE = DEFAULT_CNC_MACHINE_CONFIG; // active bit em-3175 = 3.175 mm, layer spindle 12000

// Expected feeds for the default 1/8" bit at the default spindle, 2 flutes —
// computed, not hard-coded, so the test verifies the wiring (material, bit,
// rpm, flutes) rather than pinning magic numbers.
function expectedFeeds(material: 'hardwood' | 'plywood-mdf') {
  return calculateFeeds({ material, bitDiameterMm: 3.175, flutes: 2, rpm: 12000 });
}

function cncLayer(id: string): Layer {
  return { ...createLayer({ id, color: id }), cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, depthMm: 10 } };
}

function cncProject(layers: ReadonlyArray<Layer>): Project {
  const base = createProject();
  return { ...base, machine: MACHINE, scene: { ...base.scene, layers } };
}

describe('layerWithCncMaterial (ADR-112)', () => {
  it('fills feeds from the material + bit and tags the layer, preserving the rest', () => {
    const filled = layerWithCncMaterial(cncLayer('#ff0000'), MACHINE, 'plywood-mdf');
    const feeds = expectedFeeds('plywood-mdf');
    expect(filled.cnc?.materialKey).toBe('plywood-mdf');
    expect(filled.cnc?.feedMmPerMin).toBe(feeds.feedMmPerMin);
    expect(filled.cnc?.plungeMmPerMin).toBe(feeds.plungeMmPerMin);
    expect(filled.cnc?.depthPerPassMm).toBe(feeds.depthPerPassMm);
    expect(filled.cnc?.depthMm).toBe(10); // untouched
  });

  it('is a no-op for an unknown material key', () => {
    const layer = cncLayer('#ff0000');
    expect(layerWithCncMaterial(layer, MACHINE, 'kryptonite')).toBe(layer);
  });
});

describe('projectWithStockMaterial (ADR-112)', () => {
  it('sets the stock material and fills every layer', () => {
    const project = projectWithStockMaterial(
      cncProject([cncLayer('#aa0000'), cncLayer('#00bb00')]),
      'hardwood',
    );
    const feeds = expectedFeeds('hardwood');
    expect(project.machine?.kind === 'cnc' ? project.machine.stock.materialKey : null).toBe(
      'hardwood',
    );
    for (const layer of project.scene.layers) {
      expect(layer.cnc?.materialKey).toBe('hardwood');
      expect(layer.cnc?.feedMmPerMin).toBe(feeds.feedMmPerMin);
    }
  });

  it('clears the stock material but leaves layer feeds intact', () => {
    const filled = projectWithStockMaterial(cncProject([cncLayer('#aa0000')]), 'hardwood');
    const cleared = projectWithStockMaterial(filled, null);
    const feeds = expectedFeeds('hardwood');
    expect(
      cleared.machine?.kind === 'cnc' ? cleared.machine.stock.materialKey : 'x',
    ).toBeUndefined();
    expect(cleared.scene.layers[0]?.cnc?.feedMmPerMin).toBe(feeds.feedMmPerMin); // kept
    expect(cleared.scene.layers[0]?.cnc?.materialKey).toBe('hardwood'); // per-layer tag kept
  });

  it('is a no-op for a laser project and for an unknown key', () => {
    const laser = createProject();
    expect(projectWithStockMaterial(laser, 'hardwood')).toBe(laser);
    const cnc = cncProject([cncLayer('#aa0000')]);
    expect(projectWithStockMaterial(cnc, 'kryptonite')).toBe(cnc);
  });
});

describe('seedLayerFromStockMaterial (ADR-112)', () => {
  it('applies the stock material to a new layer when one is set', () => {
    const machine = { ...MACHINE, stock: { ...MACHINE.stock, materialKey: 'plywood-mdf' } };
    const seeded = seedLayerFromStockMaterial(cncLayer('#aa0000'), machine);
    expect(seeded.cnc?.materialKey).toBe('plywood-mdf');
    expect(seeded.cnc?.feedMmPerMin).toBe(expectedFeeds('plywood-mdf').feedMmPerMin);
  });

  it('leaves the layer unchanged when no stock material is set', () => {
    const layer = cncLayer('#aa0000');
    expect(seedLayerFromStockMaterial(layer, MACHINE)).toBe(layer);
  });
});
