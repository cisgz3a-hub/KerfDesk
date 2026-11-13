// Adjust Image, bound to the image it was opened on (tools audit T1,
// T14R-P2-1): a selection change while it is open, from the canvas, the phone
// or MCP, neither moves the draft onto another image nor closes it, as Photo
// engraving is bound by ADR-581 decision 7. It closes when that image is gone.

import { useEffect } from 'react';
import { operationOverrideForObject } from '../../core/effective-output';
import {
  primaryOperationForObject,
  sceneObjectUsesOperation,
  type RasterImage,
} from '../../core/scene';
import { AdjustImageDialog, type AdjustImageApply } from '../raster/AdjustImageDialog';
import { useStore } from '../state';

export function AdjustImageDialogHost(props: {
  readonly imageId: string;
  readonly onClose: () => void;
}): JSX.Element | null {
  const image = useStore((s): RasterImage | null => {
    const object = s.project.scene.objects.find((candidate) => candidate.id === props.imageId);
    return object?.kind === 'raster-image' ? object : null;
  });
  const layer = useStore((s) =>
    image === null ? null : primaryOperationForObject(image, s.project.scene.layers),
  );
  // Without its own override, OK writes the operation-level fields to the
  // operation, so every other image on it changes too (T14-P2-1).
  const sharedWith = useStore((s) =>
    image === null || layer === null || operationOverrideForObject(layer, image) !== undefined
      ? 0
      : s.project.scene.objects.filter(
          (object) => object.id !== image.id && sceneObjectUsesOperation(object, layer),
        ).length,
  );
  const setRasterImageAdjustments = useStore((s) => s.setRasterImageAdjustments);
  const { onClose } = props;
  const missing = image === null || layer === null;
  useEffect(() => {
    if (missing) onClose();
  }, [missing, onClose]);
  if (image === null || layer === null) return null;
  const onApply = (patch: AdjustImageApply): void => {
    onClose();
    setRasterImageAdjustments(image.id, patch.imagePatch, {
      id: layer.id,
      patch: patch.layerPatch,
    });
  };
  return (
    <AdjustImageDialog
      image={image}
      layer={layer}
      sharedWith={sharedWith}
      onCancel={onClose}
      onApply={onApply}
    />
  );
}
