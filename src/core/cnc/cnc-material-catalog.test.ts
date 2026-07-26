import { describe, expect, it } from 'vitest';
import {
  CHIPLOAD_MATERIALS,
  CNC_MATERIAL_GROUPS,
  cncMaterialFamilyFor,
  findCncMaterialPreset,
  isChiploadMaterialKey,
} from './cnc-material-catalog';

describe('CNC material catalog', () => {
  it('groups common wood species under softwood and hardwood', () => {
    const hardwoods = CNC_MATERIAL_GROUPS.find((group) => group.label === 'Hardwoods');
    const softwoods = CNC_MATERIAL_GROUPS.find((group) => group.label === 'Softwoods');
    expect(hardwoods?.materials.map((material) => material.value)).toContain('hardwood-walnut');
    expect(softwoods?.materials.map((material) => material.value)).toContain('softwood-pine');
  });

  it('keeps species identity while resolving its calculation family', () => {
    expect(findCncMaterialPreset('hardwood-hard-maple')).toMatchObject({
      label: 'Hard maple',
      family: 'hardwood',
    });
    expect(cncMaterialFamilyFor('hardwood-hard-maple')).toBe('hardwood');
    expect(cncMaterialFamilyFor('softwood-cedar')).toBe('softwood');
  });

  it('accepts every catalog key and rejects unknown values', () => {
    for (const material of CHIPLOAD_MATERIALS) {
      expect(isChiploadMaterialKey(material.value)).toBe(true);
    }
    for (const bad of ['unobtainium', '', 'ALUMINUM', undefined, null, 3, {}]) {
      expect(isChiploadMaterialKey(bad)).toBe(false);
    }
  });
});
