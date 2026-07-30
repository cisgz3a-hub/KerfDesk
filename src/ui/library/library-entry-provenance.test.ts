import { describe, expect, it } from 'vitest';
import { DESIGN_LIBRARY } from './design-library';
import { libraryAssetProvenanceFor } from './library-entry-provenance';

describe('libraryAssetProvenanceFor', () => {
  it('captures the catalog identity and exact source fields needed after save or catalog changes', () => {
    const entry = DESIGN_LIBRARY.find((candidate) => candidate.id === 'icon-moon');
    if (entry === undefined) throw new Error('expected moon entry');

    expect(libraryAssetProvenanceFor(entry)).toEqual({
      schemaVersion: 1,
      assetId: 'icon-moon',
      title: 'Moon',
      sourceName: 'Lucide',
      licenseId: 'ISC AND MIT',
      creator: 'Lucide contributors; Feather icon by Cole Bemis',
      sourceUrl: 'https://github.com/lucide-icons/lucide',
      licenseUrl: 'https://lucide.dev/license',
      sourceVersion: 'lucide-static@1.23.0',
    });
  });
});
