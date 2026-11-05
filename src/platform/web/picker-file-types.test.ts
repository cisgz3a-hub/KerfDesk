import { describe, expect, it } from 'vitest';
import { pickerTypeDescription } from './picker-file-types';

describe('pickerTypeDescription (UX audit U1-P3-6)', () => {
  it('names a project save as a KerfDesk project, not "Files"', () => {
    expect(pickerTypeDescription(['.lf2'])).toBe('KerfDesk project');
  });

  it('names G-code once for both of its extensions', () => {
    expect(pickerTypeDescription(['.gcode', '.nc'])).toBe('G-code');
  });

  it('joins two kinds, as Open project does with LightBurn files', () => {
    expect(pickerTypeDescription(['.lf2', '.lbrn', '.lbrn2'])).toBe(
      'KerfDesk project or LightBurn project',
    );
  });

  it('calls a longer mix "Supported files"', () => {
    expect(pickerTypeDescription(['.svg', '.dxf', '.pdf', '.png'])).toBe('Supported files');
  });

  it('names an unlisted extension by itself', () => {
    expect(pickerTypeDescription(['.gpl'])).toBe('GPL file');
  });

  it('is case-insensitive on the extension', () => {
    expect(pickerTypeDescription(['.SVG'])).toBe('SVG drawing');
  });
});
