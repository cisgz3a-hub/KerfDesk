import type { ImportedSvg } from '../../core/scene';
import type { LibraryEntry } from './design-library-types';

type LibraryAssetProvenance = NonNullable<ImportedSvg['libraryProvenance']>;

export function libraryAssetProvenanceFor(entry: LibraryEntry): LibraryAssetProvenance {
  const provenance = entry.provenance;
  return {
    schemaVersion: 1,
    assetId: entry.id,
    title: entry.title,
    sourceName: provenance.sourceName,
    licenseId: provenance.licenseId,
    ...(provenance.creator === undefined ? {} : { creator: provenance.creator }),
    ...(provenance.sourceUrl === undefined ? {} : { sourceUrl: provenance.sourceUrl }),
    ...(provenance.licenseUrl === undefined ? {} : { licenseUrl: provenance.licenseUrl }),
    ...(provenance.sourceVersion === undefined ? {} : { sourceVersion: provenance.sourceVersion }),
    ...(provenance.assetHash === undefined ? {} : { assetHash: provenance.assetHash }),
  };
}
