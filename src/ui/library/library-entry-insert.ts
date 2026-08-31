import type { ImportedSvg } from '../../core/scene';
import { parseSvg } from '../../io/svg';
import { captureImportDocumentOwner } from '../app/import-dispatch';
import type { ImportOutcome } from '../state/store';
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

export type LibraryInsertResult = 'added' | 'failed' | 'stale';

/** Load and insert only while the initiating document and exact dialog request own it. */
export async function insertLibraryEntryForDocument(args: {
  readonly entry: LibraryEntry;
  readonly id: string;
  readonly getProjectDocumentEpoch: () => number;
  readonly isRequestCurrent: () => boolean;
  readonly importSvgObject: (object: ImportedSvg) => ImportOutcome;
}): Promise<LibraryInsertResult> {
  const owner = captureImportDocumentOwner(args.getProjectDocumentEpoch);
  const isCurrent = (): boolean => owner.isCurrent() && args.isRequestCurrent();
  try {
    const object = await librarySvgObjectFor(args.entry, args.id);
    if (!isCurrent()) return 'stale';
    if (object === null) return 'failed';
    return args.importSvgObject(object).kind === 'added' ? 'added' : 'failed';
  } catch {
    return isCurrent() ? 'failed' : 'stale';
  }
}
