// Builds the LightBurn parity tools slice of AppCommandContext. It needs the
// platform (file pickers), which the batch 3 and 5 builders do not receive.

import type { SceneObject } from '../../core/scene';
import type { usePlatform } from '../app/platform-context';
import { saveWorkspacePreviewImage } from '../app/save-preview-image';
import type { useStore } from '../state';
import type { useToastStore } from '../state/toast-store';
import type { ParityToolsCommandContext } from './parity-tools-command-types';
import { useSaveOriginalImageStore } from './SaveOriginalImageDialog';

export function parityToolsCommandContext(
  app: ReturnType<typeof useStore.getState>,
  platform: ReturnType<typeof usePlatform>,
  pushToast: ReturnType<typeof useToastStore.getState>['pushToast'],
  selected: SceneObject | null,
): ParityToolsCommandContext {
  return {
    saveOriginalImage: () => {
      if (selected?.kind === 'raster-image') useSaveOriginalImageStore.getState().open(selected);
    },
    savePreviewImage: () =>
      void saveWorkspacePreviewImage({ platform, savedName: app.savedName, pushToast }),
  };
}
