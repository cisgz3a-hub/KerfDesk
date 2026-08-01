import { describe, expect, it } from 'vitest';
import { materialAppearance } from './material-appearance';

const KEYS = ['softwood', 'hardwood', 'plywood-mdf', 'acrylic', 'aluminum'] as const;

describe('materialAppearance', () => {
  it('keeps the original wood palette for a job with no material chosen', () => {
    // "Custom" must render exactly as the previews did before this table
    // existed, or every unconfigured project silently changes appearance.
    const custom = materialAppearance(undefined);
    expect(custom.shallowRgb).toEqual([196, 160, 116]);
    expect(custom.deepRgb).toEqual([74, 48, 28]);
  });

  it('gives every material a distinct shallow colour', () => {
    // The whole point is telling stocks apart at a glance; two materials
    // sharing a top colour would defeat it.
    const shallows = new Set(KEYS.map((key) => materialAppearance(key).shallow));
    expect(shallows.size).toBe(KEYS.length);
  });

  it('shades a named wood species with its material family', () => {
    expect(materialAppearance('hardwood-walnut')).toEqual(materialAppearance('hardwood'));
    expect(materialAppearance('softwood-pine')).toEqual(materialAppearance('softwood'));
  });

  it('packs the RGB triples to the same colour the 3D view uses', () => {
    // The 2D map reads the triples and the 3D view reads the packed number.
    // If these ever disagree the two previews shade the same cut differently.
    for (const key of KEYS) {
      const { shallow, shallowRgb, deep, deepRgb } = materialAppearance(key);
      expect(shallow).toBe((shallowRgb[0] << 16) | (shallowRgb[1] << 8) | shallowRgb[2]);
      expect(deep).toBe((deepRgb[0] << 16) | (deepRgb[1] << 8) | deepRgb[2]);
    }
  });

  it('ramps from lighter stock top to darker full depth', () => {
    // Depth reads as darkness in both previews; a material whose ramp ran the
    // other way would make a deep pocket look like uncut stock.
    const luma = (rgb: readonly [number, number, number]): number =>
      0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    for (const key of [...KEYS, undefined]) {
      const { shallowRgb, deepRgb } = materialAppearance(key);
      expect(luma(shallowRgb)).toBeGreaterThan(luma(deepRgb));
    }
  });

  it('marks only aluminium as metallic', () => {
    // metalness on a dielectric renders it as chrome, which is why wood and
    // acrylic must stay at zero even though acrylic is glossy.
    expect(materialAppearance('aluminum').metalness).toBeGreaterThan(0);
    for (const key of ['softwood', 'hardwood', 'plywood-mdf', 'acrylic'] as const) {
      expect(materialAppearance(key).metalness).toBe(0);
    }
  });

  it('makes acrylic glossier than any of the woods', () => {
    const acrylic = materialAppearance('acrylic').roughness;
    for (const key of ['softwood', 'hardwood', 'plywood-mdf'] as const) {
      expect(acrylic).toBeLessThan(materialAppearance(key).roughness);
    }
  });
});
