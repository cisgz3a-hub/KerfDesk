import type { ImportedSvg } from '../../core/scene';
import { parseSvg } from '../../io/svg';
import type { LibraryEntry } from './design-library-types';
import { libraryAssetProvenanceFor } from './library-entry-provenance';
import { libraryRoundStrokeWidthMm } from './library-round-stroke';

export async function librarySvgObjectFor(
  entry: LibraryEntry,
  id: string,
): Promise<ImportedSvg | null> {
  if (entry.insert.kind !== 'svg') return null;
  const svgText = await entry.insert.loadSvgText();
  const result = parseSvg({
    svgText,
    id,
    source: `Library: ${entry.title}`,
  });
  if (result.object === null) return null;
  const strokeWidthMm = libraryRoundStrokeWidthMm(entry, svgText);
  return {
    ...result.object,
    libraryProvenance: libraryAssetProvenanceFor(entry),
    ...(strokeWidthMm === undefined
      ? {}
      : {
          paths: result.object.paths.map((path) => ({ ...path, strokeWidthMm })),
        }),
  };
}
