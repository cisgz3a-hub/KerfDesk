import { describe, expect, it } from 'vitest';
import { parseSvg } from '../../io/svg';
import { DESIGN_LIBRARY, LIBRARY_CATEGORIES } from './design-library';
import { validateDesignLibraryCatalog } from './design-library-validation';

describe('design library catalog', () => {
  it('has professional metadata for every entry', () => {
    const result = validateDesignLibraryCatalog(DESIGN_LIBRARY);
    expect(result).toEqual([]);
    expect(DESIGN_LIBRARY.length).toBeGreaterThan(40);
    expect(LIBRARY_CATEGORIES).toContain('Laser Templates');
    expect(LIBRARY_CATEGORIES).toContain('CNC Templates');
    expect(LIBRARY_CATEGORIES).toContain('Icons & Symbols');
  });

  it('uses stable unique ids', () => {
    const ids = DESIGN_LIBRARY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))).toBe(true);
  });

  it('parses every SVG-backed entry through the production SVG importer', () => {
    for (const entry of DESIGN_LIBRARY) {
      if (entry.insert.kind !== 'svg') continue;
      const result = parseSvg({
        svgText: entry.insert.svgText,
        id: `test-${entry.id}`,
        source: `Library: ${entry.title}`,
      });
      expect(result.object, entry.id).not.toBeNull();
    }
  });
});
