import { sceneObjectHasVisibleLayer, type SceneObject } from '../../core/scene';
import {
  buildSelectionNudgeEdit,
  buildSelectionTransformEdit,
} from '../../core/scene/selection-transform';
import { combinedBBox, transformedBBox } from '../../core/scene/hit-test';
import type { AppState } from '../state/store';
import type { SelectionTransformEdit } from '../state/selection-transform-actions';
import type { RemoteTransform } from './types';
import { RemoteFault } from './fault';
import { publicIdentifier, remoteBounds } from './projections';

export function editableArtwork(state: AppState, ids: readonly string[]): SceneObject[] {
  return ids.map((id) => {
    if (!publicIdentifier(id)) throw new RemoteFault('unsupported_operation');
    const object = state.project.scene.objects.find((candidate) => candidate.id === id);
    if (object === undefined) throw new RemoteFault('not_found');
    if (object.locked === true || !sceneObjectHasVisibleLayer(state.project.scene, object))
      throw new RemoteFault('not_editable');
    return object;
  });
}
export function prepareTransforms(
  objects: readonly SceneObject[],
  edit: RemoteTransform,
): readonly SelectionTransformEdit[] {
  let transforms: readonly SelectionTransformEdit[];
  if (edit.type === 'rotate') transforms = rotateGroup(objects, edit.angleDeg);
  else {
    const result =
      edit.type === 'move'
        ? buildSelectionNudgeEdit(objects, edit.dxMm, edit.dyMm)
        : buildSelectionTransformEdit(objects, {
            kind: 'resize',
            anchor: 'nw',
            width: edit.widthMm,
            height: edit.heightMm,
            preserveAspect: false,
          });
    if (result.kind !== 'ok') throw new RemoteFault('unsupported_operation');
    transforms = result.transforms;
  }
  for (const [index, object] of objects.entries()) {
    const transform = transforms[index]?.transform;
    if (
      transform === undefined ||
      ![transform.x, transform.y, transform.scaleX, transform.scaleY, transform.rotationDeg].every(
        Number.isFinite,
      ) ||
      remoteBounds(transformedBBox({ ...object, transform })) === undefined
    )
      throw new RemoteFault('unsupported_operation');
  }
  return transforms;
}
/** Relative clockwise scene rotation, rigid about the combined world-bounds centre. */
function rotateGroup(
  objects: readonly SceneObject[],
  angle: number,
): readonly SelectionTransformEdit[] {
  const bounds = combinedBBox(objects);
  if (bounds === null) throw new RemoteFault('not_found');
  const x = (bounds.minX + bounds.maxX) / 2;
  const y = (bounds.minY + bounds.maxY) / 2;
  const radians = ((angle % 360) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return objects.map((object) => {
    const dx = object.transform.x - x;
    const dy = object.transform.y - y;
    return {
      id: object.id,
      transform: {
        ...object.transform,
        x: x + dx * cos - dy * sin,
        y: y + dx * sin + dy * cos,
        rotationDeg: (((object.transform.rotationDeg + angle) % 360) + 360) % 360,
      },
    };
  });
}
