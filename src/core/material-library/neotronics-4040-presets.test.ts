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
      'Clear acrylic is not recommended for a 450/455 nm diode laser.',
    );
  });
});
