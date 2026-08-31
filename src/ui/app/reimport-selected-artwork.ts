import type { ImportedSvg, SceneObject } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import type { ImportOutcome } from '../state/store';
import type { ToastVariant } from '../state/toast-store';
import { captureImportDocumentOwner } from './import-dispatch';
import { importDxfFiles } from './dxf-import-action';
import { importSvgFiles } from './svg-import-action';

type PushToast = (message: string, variant?: ToastVariant) => void;

export function canReimportSelectedArtwork(object: SceneObject): object is ImportedSvg {
  if (object.kind !== 'imported-svg' || object.libraryProvenance !== undefined) return false;
  const source = object.source.toLowerCase();
  return source.endsWith('.svg') || source.endsWith('.dxf');
}

export async function handleReimportSelectedArtwork(args: {
  readonly platform: PlatformAdapter;
  readonly target: ImportedSvg;
  readonly getProjectDocumentEpoch: () => number;
  readonly getTargetObject: () => SceneObject | undefined;
  readonly reimportObject: (targetId: string, object: SceneObject) => ImportOutcome | null;
  readonly pushToast: PushToast;
}): Promise<void> {
  const documentOwner = captureImportDocumentOwner(args.getProjectDocumentEpoch);
  const ownerIsCurrent = (): boolean =>
    documentOwner.isCurrent() && args.getTargetObject() === args.target;
  const pushToast: PushToast = (message, variant) => {
    if (ownerIsCurrent()) args.pushToast(message, variant);
  };
  const extension = args.target.source.toLowerCase().endsWith('.dxf') ? '.dxf' : '.svg';
  let files: Awaited<ReturnType<PlatformAdapter['pickFilesForOpen']>>;
  try {
    files = await args.platform.pickFilesForOpen({ accept: [extension], multiple: false });
  } catch (error) {
    pushToast(`Could not re-import ${args.target.source}: ${messageOf(error)}`, 'error');
    return;
  }
  if (!ownerIsCurrent()) return;
  const file = files[0];
  if (file === undefined) return;
  if (!file.name.toLowerCase().endsWith(extension)) {
    pushToast(`Could not re-import: choose a ${extension.toUpperCase()} source file.`, 'error');
    return;
  }
  const replaceTarget = (object: SceneObject): ImportOutcome => {
    if (!ownerIsCurrent()) throw new Error('the selected source owner changed');
    const outcome = args.reimportObject(args.target.id, object);
    if (outcome === null) {
      throw new Error('the selected source object changed or no longer exists');
    }
    return outcome;
  };
  if (extension === '.dxf') {
    await importDxfFiles([file], { importObject: replaceTarget, pushToast });
    return;
  }
  await importSvgFiles([file], replaceTarget, pushToast);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
