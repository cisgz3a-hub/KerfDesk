// The aspect lock stays off by default (LightBurn parity; a default-on lock
// rescaled the other dimension on every edit). So the lock says which state it
// is in, and a photo stretched by one typed dimension says how to undo it (UX
// audit U3-P3-2: W 100 on a 360 × 270 photo gave 100 × 270, a squashed face).

import type { SceneObject, SelectionTransformEdit } from '../../core/scene';
import { Icon } from '../kit/icons';

function aspectLockTitle(locked: boolean): string {
  return locked
    ? 'Locked: width and height stay in proportion when you type one. Click to set them separately.'
    : 'Unlocked: width and height change separately. Click to keep them in proportion.';
}

export const STRETCHED_IMAGE_NOTICE =
  'Only one side of the image changed, so it is stretched. Undo (Ctrl+Z) restores it; turn on the lock beside W and H to keep its proportions.';

/** True when a typed resize changed one side of a selection holding a photo. */
export function stretchesImage(
  objects: ReadonlyArray<SceneObject>,
  edit: SelectionTransformEdit,
): boolean {
  if (edit.kind !== 'resize' || edit.preserveAspect) return false;
  if ((edit.width === undefined) === (edit.height === undefined)) return false;
  return objects.some((object) => object.kind === 'raster-image');
}

export function AspectLockButton(props: {
  readonly locked: boolean;
  readonly disabled: boolean;
  readonly onToggle: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="lf-btn lf-numeric-aspect-lock"
      aria-label="Lock aspect ratio"
      title={aspectLockTitle(props.locked)}
      aria-pressed={props.locked}
      disabled={props.disabled}
      onClick={props.onToggle}
    >
      <Icon name={props.locked ? 'lock' : 'unlock'} size={14} />
    </button>
  );
}
