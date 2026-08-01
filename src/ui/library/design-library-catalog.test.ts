import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSvg } from '../../io/svg';
import { DESIGN_LIBRARY, LIBRARY_CATEGORIES } from './design-library';
import { TABLER_LIBRARY_ASSET_NAMES } from './design-library-tabler';
import { validateDesignLibraryCatalog } from './design-library-validation';

describe('design library catalog', () => {
  it('has professional metadata for every entry', () => {
    expect(validateDesignLibraryCatalog(DESIGN_LIBRARY)).toEqual([]);
    expect(DESIGN_LIBRARY.length).toBeGreaterThanOrEqual(60);
    expect(LIBRARY_CATEGORIES).toContain('Laser Templates');
    expect(LIBRARY_CATEGORIES).toContain('CNC Templates');
    expect(LIBRARY_CATEGORIES).toContain('Icons & Symbols');
  });

  it('uses stable unique ids', () => {
    const ids = DESIGN_LIBRARY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))).toBe(true);
  });

  it('lazily loads and parses every SVG-backed entry through the production importer', async () => {
    for (const entry of DESIGN_LIBRARY) {
      if (entry.insert.kind !== 'svg') continue;
      const svgText = await entry.insert.loadSvgText();
      const result = parseSvg({
        svgText,
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

  it('uses one pinned, non-brand Tabler family for bundled customer artwork', () => {
    const artwork = DESIGN_LIBRARY.filter((entry) => entry.kind === 'bundled-artwork');
    expect(artwork).toHaveLength(TABLER_LIBRARY_ASSET_NAMES.length);
    expect(artwork.length).toBeGreaterThanOrEqual(40);
    expect(new Set(artwork.map((entry) => entry.title)).size).toBe(artwork.length);
    expect(new Set(artwork.map((entry) => entry.provenance.assetHash)).size).toBe(artwork.length);
    expect(new Set(artwork.map((entry) => entry.subcategory))).toEqual(
      new Set([
        'Pets & Wildlife',
        'Garden & Outdoors',
        'Kitchen & Café',
        'Home & Workshop',
        'Celebration & Marks',
        'Hobbies & Outdoors',
      ]),
    );
    for (const entry of artwork) {
      expect(entry.id).toMatch(/^tabler-/);
      expect(entry.id).not.toMatch(/^tabler-brand-/);
      expect(entry.provenance.sourceKind).toBe('tabler');
      expect(entry.provenance.sourceName).toBe('Tabler Icons');
      expect(entry.provenance.licenseId).toBe('MIT');
      expect(entry.provenance.sourceVersion).toContain('@tabler/icons@3.43.0');
      expect(entry.provenance.sourceVersion).toContain('e40738b64486f857128ae58335354681e4e9dc9b');
      expect(entry.provenance.sourceUrl).toMatch(
        /^https:\/\/github\.com\/tabler\/tabler-icons\/blob\/e40738b64486f857128ae58335354681e4e9dc9b\/icons\/outline\//,
      );
      expect(entry.provenance.licenseUrl).toBe(
        'https://github.com/tabler/tabler-icons/blob/e40738b64486f857128ae58335354681e4e9dc9b/LICENSE',
      );
      expect(entry.provenance.assetHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(entry.preview.kind).toBe('asset-url');
      if (entry.preview.kind === 'asset-url') {
        expect(entry.preview.url).not.toMatch(/^data:/);
      }
    }
  });

  it('matches every per-item manifest hash to the pinned installed package bytes', () => {
    const entriesById = new Map(DESIGN_LIBRARY.map((entry) => [entry.id, entry]));
    for (const assetName of TABLER_LIBRARY_ASSET_NAMES) {
      const bytes = readFileSync(
        resolve('node_modules', '@tabler', 'icons', 'icons', 'outline', `${assetName}.svg`),
      );
      const actual = createHash('sha256').update(bytes).digest('hex');
      expect(entriesById.get(`tabler-${assetName}`)?.provenance.assetHash).toBe(`sha256:${actual}`);
    }
  });

  it('keeps superseded Lucide and Openclipart artwork out of the curated starter catalog', () => {
    const sourceKinds = new Set(DESIGN_LIBRARY.map((entry) => entry.provenance.sourceKind));
    expect(sourceKinds).not.toContain('lucide');
    expect(sourceKinds).not.toContain('cc0');
    expect(sourceKinds).not.toContain('public-domain');
  });
});
