import type { SceneObject } from '../../core/scene';
import type { FileHandle, PlatformAdapter } from '../../platform/types';
import type { GcodeInspectionSource } from '../gcode-inspector';
import { importImageFile } from '../commands/import-image-action';
import type { ImportOutcome } from '../state/store';
import type { ToastVariant } from '../state/toast-store';
import { importDxfFiles } from './dxf-import-action';
import { openGcodeFileInInspector } from './gcode-open-action';
import { importStlFiles } from './stl-import-action';
import { importSvgFiles } from './svg-import-action';

export const ARTWORK_IMPORT_EXTENSIONS = ['.svg', '.dxf', '.png', '.jpg', '.jpeg', '.stl'] as const;

export type ImportDispatchActions = {
  readonly getProjectDocumentEpoch: () => number;
  readonly importSvgObject: (object: SceneObject, batchIndex?: number) => ImportOutcome;
  readonly importRasterImage: (object: SceneObject, batchIndex?: number) => void;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
  readonly openGcodeInspector?: (name: string, source: GcodeInspectionSource) => void;
};

type ImportFileKind = 'svg' | 'dxf' | 'image' | 'stl' | 'gcode';
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
  const owner = captureImportDocumentOwner(actions);
  await dispatchOwnedImportFiles(files, actions, owner, options);
}

async function dispatchOwnedImportFiles(
  files: ReadonlyArray<File>,
  actions: ImportDispatchActions,
  owner: ImportDocumentOwner,
  options: { readonly sourceLabel?: 'Drop' | 'Import' },
): Promise<void> {
  const ownedActions = bindImportActionsToDocument(actions, owner);
  const recognized = recognizedImportFiles(files, ownedActions, options.sourceLabel ?? 'Import');
  if (recognized === null) return;

  let successfulArtworkCount = 0;
  let openedGcode = false;
  const additionalGcodeNames: string[] = [];
  const nextSuccessIndex = (): number => successfulArtworkCount++;
  for (const { file, kind } of recognized) {
    if (!owner.isCurrent()) return;
    if (kind === 'gcode' && openedGcode) {
      additionalGcodeNames.push(file.name);
      continue;
    }
    try {
      await dispatchOneFile(file, kind, ownedActions, nextSuccessIndex);
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
      `${sourceLabel} ignored — no SVG, DXF, image (PNG/JPG), STL, or G-code files in the selection`,
      'warning',
    );
    return null;
  }
  const ignored = files.length - recognized.length;
  if (ignored > 0) {
    actions.pushToast(
      `Ignored ${ignored} file(s) — only SVG, DXF, PNG, JPG, STL, and G-code import`,
      'warning',
    );
  }
  return recognized;
}

export async function handleUnifiedArtworkImport(
  platform: PlatformAdapter,
  actions: ImportDispatchActions,
): Promise<void> {
  const owner = captureImportDocumentOwner(actions);
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

type ImportDocumentOwner = {
  readonly isCurrent: () => boolean;
};

function captureImportDocumentOwner(actions: ImportDispatchActions): ImportDocumentOwner {
  const epoch = actions.getProjectDocumentEpoch();
  return { isCurrent: () => actions.getProjectDocumentEpoch() === epoch };
}

function bindImportActionsToDocument(
  actions: ImportDispatchActions,
  owner: ImportDocumentOwner,
): ImportDispatchActions {
  const assertCurrent = (): void => {
    if (!owner.isCurrent()) throw new StaleImportCompletion();
  };
  return {
    ...actions,
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
): Promise<void> {
  if (kind === 'svg') {
    await importSvgFiles([file], actions.importSvgObject, actions.pushToast, { nextSuccessIndex });
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
  if (kind === 'svg' || kind === 'dxf') {
    return new File([await handle.text()], handle.name, { type: 'text/plain' });
  }
  throw new Error('the platform did not provide binary file data');
}

export function importFileKind(file: Pick<File, 'name' | 'type'>): ImportFileKind | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.svg')) return 'svg';
  if (name.endsWith('.dxf')) return 'dxf';
  if (file.type === 'image/png' || file.type === 'image/jpeg') return 'image';
  if (name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image';
  if (name.endsWith('.stl')) return 'stl';
  if (name.endsWith('.nc') || name.endsWith('.gcode') || name.endsWith('.tap')) return 'gcode';
  return null;
}
