import { describe, expect, it } from 'vitest';
import {
  NEOTRONICS_4040_MAX_LT4LDS_V2_PRESETS,
  isUnsupportedPreset,
  materialPresetWarnings,
} from './neotronics-4040-presets';

describe('NEOTRONICS_4040_MAX_LT4LDS_V2_PRESETS', () => {
  it('ships researched starter recipes with safety warnings instead of guaranteed settings', () => {
    const ids = NEOTRONICS_4040_MAX_LT4LDS_V2_PRESETS.map((preset) => preset.id);

    expect(ids).toContain('neotronics-lt4lds-wood-engrave-254dpi');
    expect(ids).toContain('neotronics-lt4lds-plywood-3mm-cut');
    expect(ids).toContain('neotronics-lt4lds-mdf-3mm-cut');
    expect(ids).toContain('neotronics-lt4lds-black-acrylic-3mm-cut');
    expect(ids).toContain('neotronics-lt4lds-paper-card-felt-thin-cut');
    expect(ids).toContain('neotronics-lt4lds-clear-acrylic-unsupported');

    const wood = NEOTRONICS_4040_MAX_LT4LDS_V2_PRESETS.find((preset) =>
      preset.id.includes('wood-engrave'),
    );
    expect(wood?.recipe).toMatchObject({
      mode: 'image',
      power: 30,
      speed: 5000,
      linesPerMm: 10,
      airAssist: false,
    });
    expect(wood?.description).toMatch(/starting point/i);

    const paper = NEOTRONICS_4040_MAX_LT4LDS_V2_PRESETS.find((preset) =>
      preset.id.includes('paper-card-felt'),
    );
    expect(materialPresetWarnings(paper!)).toContain('Thin stock can ignite. Stay present.');

    const clearAcrylic = NEOTRONICS_4040_MAX_LT4LDS_V2_PRESETS.find((preset) =>
      preset.id.includes('clear-acrylic'),
    );
    expect(isUnsupportedPreset(clearAcrylic!)).toBe(true);
    expect(materialPresetWarnings(clearAcrylic!)).toContain(
      'A 450/455 nm diode laser cannot cut or engrave clear acrylic.',
    );

    const blackAcrylic = NEOTRONICS_4040_MAX_LT4LDS_V2_PRESETS.find((preset) =>
      preset.id.includes('black-acrylic'),
    );
    expect(materialPresetWarnings(blackAcrylic!).join(' ')).toMatch(/clear, white or blue/);
  });

  it('cuts thin stock in dynamic power so slowed corners do not overburn', () => {
    const paper = presetById('neotronics-lt4lds-paper-card-felt-thin-cut');

    expect(paper.recipe).toMatchObject({ powerMode: 'dynamic', power: 90, speed: 4000 });
    expect(materialPresetWarnings(paper).join(' ')).toMatch(/not for corrugated/i);
  });

  it('cuts 3 mm MDF slower than plywood, in two passes, with a test piece first', () => {
    const mdf = presetById('neotronics-lt4lds-mdf-3mm-cut');
    const plywood = presetById('neotronics-lt4lds-plywood-3mm-cut');

    expect(mdf.recipe).toMatchObject({ power: 100, speed: 480, passes: 2, airAssist: true });
    expect(mdf.recipe.speed).toBeLessThan(plywood.recipe.speed);
    expect(materialPresetWarnings(mdf).join(' ')).toMatch(/test piece first/i);
  });

  it('gives presets changed by the audit a new revision so linked layers read as stale', () => {
    const plywood = presetById('neotronics-lt4lds-plywood-3mm-cut');

    for (const id of [
      'neotronics-lt4lds-mdf-3mm-cut',
      'neotronics-lt4lds-paper-card-felt-thin-cut',
    ]) {
      expect(presetById(id).revision).not.toBe(plywood.revision);
    }
  });
});

function presetById(id: string): (typeof NEOTRONICS_4040_MAX_LT4LDS_V2_PRESETS)[number] {
  const found = NEOTRONICS_4040_MAX_LT4LDS_V2_PRESETS.find((preset) => preset.id === id);
  if (found === undefined) throw new Error(`missing preset ${id}`);
  return found;
}
