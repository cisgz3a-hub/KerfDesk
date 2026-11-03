import { prepareSvgFragment } from '../import/svg-image-hydration';
import type { SvgArtworkFragment } from '../state/svg-fragment-mutation';
import type { SceneObject } from '../../core/scene';
import { parseSvg, type ParseSvgResult } from '../../io/svg';
import { parseSvgOffThread } from '../import/document-import-worker-client';
import { importByteSize, resolveImportBlob, type BlobSourceFile } from '../import/import-file-blob';
import type { ImportOutcome } from '../state/store';
import type { ToastVariant } from '../state/toast-store';
import { createImportWorkerControls, isImportCancellation } from './import-worker-controls';
import { describeImportBedFit, type ImportBedFitUndo } from './import-bed-fit-notice';
import { describeImportWhiteKnockout } from './import-white-knockout-notice';
import { largeImportAdvisory, mainThreadImportFallbackAdvisory } from './import-size-advisory';
import {
  describeImportError,
  describeImportResult,
  describeReimportOutcome,
  describeSvgPresentationWarnings,
  type ToastDescriptor,
} from './import-toasts';

export async function importSvgFiles(
  files: ReadonlyArray<BlobSourceFile>,
  importObject: (object: SceneObject, batchIndex?: number) => ImportOutcome,
  pushToast: (message: string, variant?: ToastVariant) => void,
  options: {
    readonly nextSuccessIndex?: () => number;
    readonly importFragment?: (fragment: SvgArtworkFragment, batchIndex?: number) => ImportOutcome;
  } = {},
): Promise<void> {
  let successIndex = 0;
  for (const file of files) {
    const controls = createImportWorkerControls(file.name, pushToast);
    try {
      const blob = await resolveImportBlob(file);
      const size = importByteSize(file, blob);
      const advisory = size === null ? null : largeImportAdvisory(file.name, size);
      if (advisory !== null) pushToast(advisory, 'warning');
      const result = await parseFile(file, blob, controls.options, pushToast);
      const outcome = await commitParsedSvg(
        result,
        importObject,
        options.importFragment,
        () => options.nextSuccessIndex?.() ?? successIndex,
        controls.options.signal,
      );
      if (outcome !== null) successIndex += 1;
      reportSvgImport(file.name, result, outcome, pushToast);
    } catch (error) {
      const toast = describeImportError(file.name, error);
      pushToast(
        isImportCancellation(error) ? `${file.name}: import cancelled.` : toast.message,
        isImportCancellation(error) ? 'warning' : toast.variant,
      );
    } finally {
      controls.dispose();
    }
  }
}

function reportSvgImport(
  name: string,
  result: ParseSvgResult,
  outcome: ImportOutcome | null,
  pushToast: (message: string, variant?: ToastVariant) => void,
): void {
  for (const toast of describeSvgImport(name, result, outcome)) {
    pushToast(toast.message, toast.variant);
  }
}

/** The toasts an SVG import shows; Remote Control returns the same text (ADR-125 Amd 2). */
export function describeSvgImport(
  name: string,
  result: ParseSvgResult,
  outcome: ImportOutcome | null,
  undo?: ImportBedFitUndo,
): ReadonlyArray<ToastDescriptor> {
  const knockoutNotice = describeImportWhiteKnockout(name, outcome ?? undefined, undo);
  const knockout = knockoutNotice === null ? [] : [knockoutNotice];
  if (outcome?.kind === 'replaced') {
    return [
      describeReimportOutcome(outcome),
      ...describeSvgPresentationWarnings(name, result),
      ...knockout,
    ];
  }
  // Last, so the three-toast stack cannot push them out of view.
  const fitNotice = describeImportBedFit(name, outcome ?? undefined, undo);
  return [
    ...describeImportResult(name, result, outcome?.whiteKnockout),
    ...(fitNotice === null ? [] : [fitNotice]),
    ...knockout,
  ];
}

async function parseFile(
  file: BlobSourceFile,
  blob: Blob | null,
  options: Parameters<typeof parseSvgOffThread>[3],
  pushToast: (message: string, variant?: ToastVariant) => void,
): Promise<ParseSvgResult> {
  const id = crypto.randomUUID();
  if (blob !== null) {
    const pending = parseSvgOffThread(blob, id, file.name, options);
    if (pending === null) {
      pushToast(mainThreadImportFallbackAdvisory(file.name), 'warning');
      return parseSvg({ svgText: await file.text(), id, source: file.name });
    }
    return pending;
  }
  return parseSvg({ svgText: await file.text(), id, source: file.name });
}

async function commitParsedSvg(
  result: ParseSvgResult,
  importObject: (object: SceneObject, batchIndex?: number) => ImportOutcome,
  importFragment:
    | ((fragment: SvgArtworkFragment, batchIndex?: number) => ImportOutcome)
    | undefined,
  nextIndex: () => number,
  signal?: AbortSignal,
): Promise<ImportOutcome | null> {
  signal?.throwIfAborted();
  if (
    result.fragment !== undefined &&
    result.fragment.entries.length > 0 &&
    importFragment !== undefined
  ) {
    const prepared = await prepareSvgFragment(
      result.fragment,
      signal === undefined ? {} : { signal },
    );
    try {
      signal?.throwIfAborted();
      const outcome = importFragment(
        {
          source: result.fragment.source,
          bounds: result.fragment.bounds,
          objects: prepared.objects,
        },
        nextIndex(),
      );
      prepared.commit();
      return outcome;
    } catch (error) {
      await prepared.rollback();
      throw error;
    }
  }
  if (result.fragment?.entries.some((entry) => entry.kind === 'svg-image'))
    throw new Error(
      'This import destination cannot accept composed SVG artwork. No artwork was added.',
    );
  return result.object === null ? null : importObject(result.object, nextIndex());
}
