import type { SceneObject } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import {
  bindImportActionsToDocument,
  captureImportDocumentOwner,
  type ImportDispatchActions,
} from '../app/import-dispatch';
import type { ImportOutcome } from '../state/store';
import type { ToastVariant } from '../state/toast-store';
import { importImageFile } from './import-image-action';
import { pickPlatformImageFile } from './platform-image-files';
import { requestPagedArtwork } from '../import/request-paged-artwork';

export type ImagePickActionContext = {
  readonly platform: PlatformAdapter;
  readonly getProjectDocumentEpoch: () => number;
  readonly importSvgObject: (object: SceneObject, batchIndex?: number) => ImportOutcome;
  readonly importRasterImage: (object: SceneObject, batchIndex?: number) => void;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
};

export async function runImagePickAction(ctx: ImagePickActionContext): Promise<SceneObject | null> {
  const actions: ImportDispatchActions = ctx;
  const owner = captureImportDocumentOwner(ctx.getProjectDocumentEpoch);
  const ownedActions = bindImportActionsToDocument(actions, owner);
  let file: File | null;
  try {
    file = await pickPlatformImageFile(ctx.platform);
  } catch (error) {
    ownedActions.pushToast(`Could not choose image: ${errorMessage(error)}`, 'error');
    return null;
  }
  if (file === null || !owner.isCurrent()) return null;
  if (/\.(tif|tiff)$/i.test(file.name) || file.type === 'image/tiff') {
    try {
      const imported = await requestPagedArtwork(
        file,
        'tiff',
        owner.isCurrent,
        ownedActions.importRasterImage,
      );
      return owner.isCurrent() ? imported : null;
    } catch (error) {
      ownedActions.pushToast('Could not import TIFF: ' + errorMessage(error), 'error');
      return null;
    }
  }
  const imported = await importImageFile(
    file,
    ownedActions.importRasterImage,
    ownedActions.pushToast,
  );
  return owner.isCurrent() ? imported : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
