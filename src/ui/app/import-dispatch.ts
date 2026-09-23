import type { SvgArtworkFragment } from '../state/svg-fragment-mutation';
import type { SceneObject } from '../../core/scene';
import type { FileHandle, PlatformAdapter } from '../../platform/types';
import type { GcodeInspectionSource } from '../gcode-inspector';
import { importImageFile } from '../commands/import-image-action';
import type { ImportOutcome } from '../state/store';
import type { ToastVariant } from '../state/toast-store';
import { importDxfFiles } from './dxf-import-action';
import { importHpglFile } from './hpgl-import-action';
import { openGcodeFileInInspector } from './gcode-open-action';
import { importStlFiles } from './stl-import-action';
import { importSvgFiles } from './svg-import-action';
import { requestPagedArtwork } from '../import/request-paged-artwork';

export const ARTWORK_IMPORT_EXTENSIONS = [
  '.svg',
  '.dxf',
  '.pdf',
  '.ai',
  '.hpgl',
  '.plt',
  '.png',
  '.jpg',
  '.jpeg',
  '.bmp',
  '.gif',
  '.tif',
  '.tiff',
  '.stl',
] as const;

export type ImportDispatchActions = {
  readonly getProjectDocumentEpoch: () => number;
  readonly importSvgFragment?: (fragment: SvgArtworkFragment, batchIndex?: number) => ImportOutcome;
  readonly importSvgObject: (object: SceneObject, batchIndex?: number) => ImportOutcome;
  readonly importRasterImage: (object: SceneObject, batchIndex?: number) => void;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
  readonly openGcodeInspector?: (name: string, source: GcodeInspectionSource) => void;
};

type ImportFileKind = 'svg' | 'dxf' | 'pdf' | 'tiff' | 'hpgl' | 'image' | 'stl' | 'gcode';
type RecognizedImportFile = { readonly file: File; readonly kind: ImportFileKind };

/**
 * Dispatches one picker/drop selection in its original order. The placement
 * index advances only when a parser actually hands an object to the store, so
 * failed files never create a gap and mixed formats share one stagger series.
 */
export async function dispatchImportFilesInOrder(
  files: ReadonlyArray<File>,
  actions: ImportDispatchActions,
  options: { readonly sourceLabel?: 'Drop' | 'Import' } = {},
): Promise<void> {
  const owner = captureImportDocumentOwner(actions.getProjectDocumentEpoch);
  await dispatchOwnedImportFiles(files, actions, owner, options);
}

async function dispatchOwnedImportFiles(
  files: ReadonlyArray<File>,
  actions: ImportDispatchActions,
  owner: ImportDocumentOwner,
  options: { readonly sourceLabel?: 'Drop' | 'Import' },
): Promise<void> {
  let successfulArtworkCount = 0;
  const ownedActions = countSuccessfulInsertions(
    bindImportActionsToDocument(actions, owner),
    () => {
      successfulArtworkCount += 1;
    },
  );
  const recognized = recognizedImportFiles(files, ownedActions, options.sourceLabel ?? 'Import');
  if (recognized === null) return;

  let openedGcode = false;
  const additionalGcodeNames: string[] = [];
  const nextSuccessIndex = (): number => successfulArtworkCount;
  for (const { file, kind } of recognized) {
    if (!owner.isCurrent()) return;
    if (kind === 'gcode' && openedGcode) {
      additionalGcodeNames.push(file.name);
      continue;
    }
    try {
      await dispatchOneFile(file, kind, ownedActions, nextSuccessIndex, owner);
      if (kind === 'gcode') openedGcode = true;
    } catch (error) {
      ownedActions.pushToast(
        `${file.name}: import failed: ${error instanceof Error ? error.message : String(error)}`,
        'error',
      );
    }
  }
  if (additionalGcodeNames.length > 0) {
    ownedActions.pushToast(
      `Ignored ${additionalGcodeNames.length} additional G-code files: ${additionalGcodeNames.join(', ')}`,
      'warning',
    );
  }
}

function countSuccessfulInsertions(
  actions: ImportDispatchActions,
  inserted: () => void,
): ImportDispatchActions {
  const fragmentSink = actions.importSvgFragment;
  return {
    ...actions,
    importSvgObject: (object, batchIndex) => {
      const outcome = actions.importSvgObject(object, batchIndex);
      inserted();
      return outcome;
    },
    importRasterImage: (object, batchIndex) => {
      actions.importRasterImage(object, batchIndex);
      inserted();
    },
    ...(fragmentSink === undefined
      ? {}
      : {
          importSvgFragment: (fragment: SvgArtworkFragment, batchIndex?: number) => {
            const outcome = fragmentSink(fragment, batchIndex);
            inserted();
            return outcome;
          },
        }),
  };
}

function recognizedImportFiles(
  files: ReadonlyArray<File>,
  actions: ImportDispatchActions,
  sourceLabel: 'Drop' | 'Import',
): ReadonlyArray<RecognizedImportFile> | null {
  const classified = files.map((file) => ({ file, kind: importFileKind(file) }));
  const recognized = classified.filter(
    (entry): entry is RecognizedImportFile => entry.kind !== null,
  );
  if (files.length > 0 && recognized.length === 0) {
    actions.pushToast(
      `${sourceLabel} ignored — no supported artwork or G-code files in the selection`,
      'warning',
    );
    return null;
  }
  const ignored = files.length - recognized.length;
  if (ignored > 0) {
    actions.pushToast(
      `Ignored ${ignored} unsupported file(s). Import SVG, DXF, PDF, compatible AI, HPGL/PLT, images, STL or G-code.`,
      'warning',
    );
  }
  return recognized;
}

export async function handleUnifiedArtworkImport(
  platform: PlatformAdapter,
  actions: ImportDispatchActions,
): Promise<void> {
  const owner = captureImportDocumentOwner(actions.getProjectDocumentEpoch);
  const ownedActions = bindImportActionsToDocument(actions, owner);
  let handles: ReadonlyArray<FileHandle>;
  try {
    handles = await platform.pickFilesForOpen({
      accept: [...ARTWORK_IMPORT_EXTENSIONS],
      multiple: true,
    });
  } catch (error) {
    ownedActions.pushToast(
      `Could not import artwork: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
    return;
  }
  const files: File[] = [];
  for (const handle of handles) {
    if (!owner.isCurrent()) return;
    try {
      files.push(await fileFromPlatformHandle(handle));
    } catch (error) {
      ownedActions.pushToast(
        `${handle.name}: import failed: ${error instanceof Error ? error.message : String(error)}`,
        'error',
      );
    }
  }
  await dispatchOwnedImportFiles(files, actions, owner, {});
}

export type ImportDocumentOwner = {
  readonly isCurrent: () => boolean;
};

export function captureImportDocumentOwner(
  getProjectDocumentEpoch: () => number,
): ImportDocumentOwner {
  const epoch = getProjectDocumentEpoch();
  return { isCurrent: () => getProjectDocumentEpoch() === epoch };
}

export function bindImportActionsToDocument(
  actions: ImportDispatchActions,
  owner: ImportDocumentOwner,
): ImportDispatchActions {
  const importSvgFragment = actions.importSvgFragment;
  const assertCurrent = (): void => {
    if (!owner.isCurrent()) throw new StaleImportCompletion();
  };
  return {
    ...actions,
    ...(importSvgFragment === undefined
      ? {}
      : {
          importSvgFragment: (fragment: SvgArtworkFragment, batchIndex?: number) => {
            assertCurrent();
            return importSvgFragment(fragment, batchIndex);
          },
        }),
    importSvgObject: (object, batchIndex) => {
      assertCurrent();
      return actions.importSvgObject(object, batchIndex);
    },
    importRasterImage: (object, batchIndex) => {
      assertCurrent();
      actions.importRasterImage(object, batchIndex);
    },
    pushToast: (message, variant) => {
      if (owner.isCurrent()) actions.pushToast(message, variant);
    },
    ...(actions.openGcodeInspector === undefined
      ? {}
      : {
          openGcodeInspector: (name: string, source: GcodeInspectionSource) => {
            assertCurrent();
            actions.openGcodeInspector?.(name, source);
          },
        }),
  };
}

class StaleImportCompletion extends Error {
  constructor() {
    super('stale import completion');
    this.name = 'StaleImportCompletion';
  }
}

async function dispatchOneFile(
  file: File,
  kind: ImportFileKind,
  actions: ImportDispatchActions,
  nextSuccessIndex: () => number,
  owner: ImportDocumentOwner,
): Promise<void> {
  if (kind === 'pdf' || kind === 'tiff') {
    await requestPagedArtwork(file, kind, owner.isCurrent, (object) => {
      if (object.kind === 'raster-image') actions.importRasterImage(object, nextSuccessIndex());
      else actions.importSvgObject(object, nextSuccessIndex());
      actions.pushToast('Added artwork: ' + file.name, 'success');
    });
    return;
  }
  if (kind === 'svg') {
    await importSvgFiles([file], actions.importSvgObject, actions.pushToast, {
      nextSuccessIndex,
      ...(actions.importSvgFragment === undefined
        ? {}
        : { importFragment: actions.importSvgFragment }),
    });
    return;
  }
  if (kind === 'dxf') {
    await importDxfFiles([file], {
      importObject: actions.importSvgObject,
      pushToast: actions.pushToast,
      nextSuccessIndex,
    });
    return;
  }
  if (kind === 'hpgl') {
    await importHpglFile(file, {
      importObject: actions.importSvgObject,
      pushToast: actions.pushToast,
      nextSuccessIndex,
    });
    return;
  }
  if (kind === 'image') {
    await importImageFile(
      file,
      (object) => actions.importRasterImage(object, nextSuccessIndex()),
      actions.pushToast,
    );
    return;
  }
  if (kind === 'stl') {
    await importStlFiles([file], {
      importObject: actions.importSvgObject,
      pushToast: actions.pushToast,
      nextSuccessIndex,
    });
    return;
  }
  if (actions.openGcodeInspector !== undefined) {
    await openGcodeFileInInspector(file, actions.openGcodeInspector, actions.pushToast);
  }
}

async function fileFromPlatformHandle(handle: FileHandle): Promise<File> {
  const blob = await handle.blob?.();
  if (blob !== undefined) {
    if (blob instanceof File && blob.name === handle.name) return blob;
    return new File([blob], handle.name, { type: blob.type });
  }
  const kind = importFileKind({ name: handle.name, type: '' });
  if (kind === 'svg' || kind === 'dxf' || kind === 'hpgl') {
    return new File([await handle.text()], handle.name, { type: 'text/plain' });
  }
  throw new Error('the platform did not provide binary file data');
}

export function importFileKind(file: Pick<File, 'name' | 'type'>): ImportFileKind | null {
  const name = file.name.toLowerCase();
  return (
    IMPORT_KINDS_BY_EXTENSION[name.slice(name.lastIndexOf('.') + 1)] ??
    IMPORT_KINDS_BY_MIME[file.type] ??
    null
  );
}

const IMPORT_KINDS_BY_EXTENSION: Readonly<Record<string, ImportFileKind>> = {
  svg: 'svg',
  dxf: 'dxf',
  pdf: 'pdf',
  ai: 'pdf',
  hpgl: 'hpgl',
  plt: 'hpgl',
  tif: 'tiff',
  tiff: 'tiff',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  bmp: 'image',
  gif: 'image',
  stl: 'stl',
  nc: 'gcode',
  gcode: 'gcode',
  tap: 'gcode',
};
const IMPORT_KINDS_BY_MIME: Readonly<Record<string, ImportFileKind>> = {
  'application/pdf': 'pdf',
  'image/tiff': 'tiff',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/bmp': 'image',
  'image/gif': 'image',
};
