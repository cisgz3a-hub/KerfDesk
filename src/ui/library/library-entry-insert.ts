import type { ImportedSvg } from '../../core/scene';
import { parseSvg } from '../../io/svg';
import type { LibraryEntry } from './design-library-types';
import { libraryAssetProvenanceFor } from './library-entry-provenance';

export function librarySvgObjectFor(entry: LibraryEntry, id: string): ImportedSvg | null {
  if (entry.insert.kind !== 'svg') return null;
  const result = parseSvg({
    svgText: entry.insert.svgText,
    id,
    source: `Library: ${entry.title}`,
  });
  return result.object === null
    ? null
    : { ...result.object, libraryProvenance: libraryAssetProvenanceFor(entry) };
}
