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

  it('includes owned laser and CNC manufacturing templates', () => {
    const ids = new Set(DESIGN_LIBRARY.map((entry) => entry.id));
    expect(ids).toContain('laser-power-speed-grid');
    expect(ids).toContain('laser-kerf-comb');
    expect(ids).toContain('laser-line-interval-test');
    expect(ids).toContain('cnc-profile-fit-test');
    expect(ids).toContain('cnc-pocket-depth-test');
    expect(ids).toContain('cnc-dogbone-corner-test');
    expect(
      DESIGN_LIBRARY.filter((entry) => entry.kind === 'owned-template').length,
    ).toBeGreaterThanOrEqual(16);
  });

  it('includes curated CC0/public-domain artwork with provenance', () => {
    const cc0 = DESIGN_LIBRARY.filter(
      (entry) =>
        entry.provenance.sourceKind === 'cc0' || entry.provenance.sourceKind === 'public-domain',
    );
    expect(cc0.length).toBeGreaterThanOrEqual(8);
    for (const entry of cc0) {
      expect(entry.provenance.sourceUrl).toMatch(/^https:\/\/openclipart\.org\/detail\//);
      expect(entry.provenance.license).toBe('CC0-1.0 / Public Domain');
      expect(entry.provenance.assetHash).toMatch(/^sha256:/);
      expect(entry.provenance.downloadedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.previewSvgText).not.toContain('FILL_ME');
      expect(entry.previewSvgText).not.toContain('PENDING_ASSET');
      expect(entry.provenance.assetHash).not.toBe('sha256:0000');
    }
  });
});
