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

/** Persistent groups form one target, including transitive overlapping memberships. */
export function expandedArtworkGroupIds(state: AppState, requested: readonly string[]): string[] {
  const ids = new Set(requested);
  const memberships = new Map<string, (readonly string[])[]>();
  for (const group of state.project.scene.groups ?? []) {
    for (const id of group.objectIds) {
      const groups = memberships.get(id) ?? [];
      groups.push(group.objectIds);
      memberships.set(id, groups);
    }
  }
  const pending = [...ids];
  for (const id of pending) {
    for (const members of memberships.get(id) ?? []) {
      for (const member of members) {
        if (ids.has(member)) continue;
        if (ids.size >= 200) throw new RemoteFault('unsupported_operation');
        ids.add(member);
        pending.push(member);
      }
    }
  }
  return [...ids];
}

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
  validateTransforms(objects, transforms);
  return transforms;
}
export function validateTransforms(
  objects: readonly SceneObject[],
  transforms: readonly SelectionTransformEdit[],
): void {
  const byId = new Map(objects.map((object) => [object.id, object]));
  for (const { id, transform } of transforms) {
    const object = byId.get(id);
    if (
      object === undefined ||
      ![transform.x, transform.y, transform.scaleX, transform.scaleY, transform.rotationDeg].every(
        Number.isFinite,
      ) ||
      remoteBounds(transformedBBox({ ...object, transform })) === undefined
    )
      throw new RemoteFault('unsupported_operation');
  }
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
