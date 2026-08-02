import { describe, expect, it } from 'vitest';
import { CHIPLOAD_MATERIALS } from '../../core/cnc';
import { woodGrainFor } from './wood-grain-appearance';

function firstKeyOfFamily(family: string): string {
  const match = CHIPLOAD_MATERIALS.find((material) => material.family === family);
  if (match === undefined) throw new Error(`no ChiploadMaterial in family ${family}`);
  return match.value;
}

describe('woodGrainFor', () => {
  it('figures timber and leaves acrylic and aluminium ungrained', () => {
    for (const family of ['softwood', 'hardwood', 'plywood-mdf']) {
      expect(woodGrainFor(firstKeyOfFamily(family) as never)).not.toBeNull();
    }
    for (const family of ['acrylic', 'aluminum']) {
      expect(woodGrainFor(firstKeyOfFamily(family) as never)).toBeNull();
    }
  });

  // "Custom" keeps the generic timber palette in material-appearance, so it has
  // to keep a grain too or an unconfigured job would render as bare plastic.
  it('grains an unconfigured job', () => {
    expect(woodGrainFor(undefined)).not.toBeNull();
  });

  it('puts several growth rings across a board, not less than one', () => {
    // Ring frequency is cycles per mm of ring coordinate, which varies by only
    // ~13 mm across a typical board. Below ~0.15 the whole stock is one band.
    for (const material of CHIPLOAD_MATERIALS) {
      const grain = woodGrainFor(material.value);
      if (grain === null) continue;
      expect(grain.ringFreq).toBeGreaterThan(0.15);
      expect(grain.contrast).toBeGreaterThan(0);
      expect(grain.contrast).toBeLessThanOrEqual(1);
      // A cut face is raw fibre against a sealed top: never darker.
      expect(grain.fresh).toBeGreaterThanOrEqual(1);
    }
  });
});
