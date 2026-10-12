// Replace Image, Replace to Fit and Refresh for the selected image (LightBurn
// bitmap commands). The new file goes through the ordinary image import, then
// only its picture moves onto the placed image, keeping position, settings,
// operation, mask and clip, in one undo step.

import type { SceneObject } from '../../core/scene';
import type { RasterReplaceMode } from '../../core/scene/raster-replace';
import { usePlatformOptional } from '../app/platform-context';
import { captureImportDocumentOwner } from '../app/import-dispatch';
import { importImageFile } from '../commands/import-image-action';
import { pickPlatformImageFile } from '../commands/platform-image-files';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';

type Action = {
  readonly label: string;
  readonly title: string;
  readonly mode: RasterReplaceMode;
  readonly sameName: boolean;
};

const ACTIONS: ReadonlyArray<Action> = [
  {
    label: 'Replace image…',
    title:
      'Swap in another picture at its own size, centred where this one is. Settings, operation, mask and clip stay.',
    mode: 'natural',
    sameName: false,
  },
  {
    label: 'Replace to fit…',
    title: 'Swap in another picture scaled to fit inside this image, keeping its proportions.',
    mode: 'fit',
    sameName: false,
  },
  {
    label: 'Refresh…',
    title:
      'Reload this picture after editing it elsewhere: choose the updated file; it keeps this size and place.',
    mode: 'fit',
    sameName: true,
  },
];

export function SelectedImageReplaceControl(props: {
  readonly object: SceneObject | null;
}): JSX.Element | null {
  const platform = usePlatformOptional();
  const target = props.object;
  if (platform === null || target?.kind !== 'raster-image' || target.locked === true) return null;
  const run = async (action: Action): Promise<void> => {
    const pushToast = useToastStore.getState().pushToast;
    const owner = captureImportDocumentOwner(() => useStore.getState().projectDocumentEpoch);
    const file = await pickPlatformImageFile(platform);
    if (file === null || !owner.isCurrent()) return;
    if (action.sameName && file.name !== target.source) {
      pushToast(
        `Refresh reloads ${target.source}; use Replace to swap in ${file.name}.`,
        'warning',
      );
      return;
    }
    await importImageFile(
      file,
      (incoming) => {
        if (!owner.isCurrent()) throw new Error('the project changed while the image loaded');
        if (!useStore.getState().replaceRasterImage(target.id, incoming, action.mode)) {
          throw new Error('the selected image changed or no longer exists');
        }
        return undefined;
      },
      pushToast,
    );
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
      {ACTIONS.map((action) => (
        <button
          key={action.label}
          type="button"
          className="lf-btn"
          title={action.title}
          onClick={() => void run(action)}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
