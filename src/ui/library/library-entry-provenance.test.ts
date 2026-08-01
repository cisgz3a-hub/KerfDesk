import { describe, expect, it } from 'vitest';
import { DESIGN_LIBRARY } from './design-library';
import { libraryAssetProvenanceFor } from './library-entry-provenance';

describe('libraryAssetProvenanceFor', () => {
  it('captures the catalog identity and exact source fields needed after save or catalog changes', () => {
    const entry = DESIGN_LIBRARY.find((candidate) => candidate.id === 'tabler-moon-stars');
    if (entry === undefined) throw new Error('expected moon and stars entry');

    expect(libraryAssetProvenanceFor(entry)).toEqual({
      schemaVersion: 1,
      assetId: 'tabler-moon-stars',
      title: 'Moon & Stars',
      sourceName: 'Tabler Icons',
      licenseId: 'MIT',
      creator: 'Paweł Kuna and Tabler Icons contributors',
      sourceUrl:
        'https://github.com/tabler/tabler-icons/blob/e40738b64486f857128ae58335354681e4e9dc9b/icons/outline/moon-stars.svg',
      licenseUrl:
        'https://github.com/tabler/tabler-icons/blob/e40738b64486f857128ae58335354681e4e9dc9b/LICENSE',
      sourceVersion: '@tabler/icons@3.43.0 / v3.43.0 / e40738b64486f857128ae58335354681e4e9dc9b',
      assetHash: 'sha256:15b86404807ec8c05b18dcaf70fc2e143bb8281785906ee5857ed1f1ebbe22c7',
    });
  });
});
