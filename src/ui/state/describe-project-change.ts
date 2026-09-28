// Names an undo step from the difference between the project before and after
// it, for steps whose action gave no name (undo-step-names.ts). Artwork comes
// first because it is what most steps change; then groups, operations and run
// order; then the project-wide settings. Pure: it reads two snapshots.

import type { Layer, Project, Scene, SceneGroup } from '../../core/scene';
import { describeObjectChange } from './describe-object-change';

const PROJECT_FIELD_NAMES: ReadonlyArray<readonly [keyof Project, string]> = [
  ['machine', 'Change machine'],
  ['device', 'Change machine setup'],
  ['parkedCncMachine', 'Change machine setup'],
  ['workspace', 'Change workspace'],
  ['jobSetup', 'Change job setup'],
  ['optimization', 'Change Cut Planner settings'],
  ['variables', 'Edit variable text data'],
  ['printAndCutTargets', 'Change Print and Cut targets'],
  ['embeddedFonts', 'Change embedded fonts'],
  ['notes', 'Edit project notes'],
];

export function describeProjectChange(before: Project, after: Project): string {
  if (before.scene !== after.scene) {
    const sceneName = describeSceneChange(before.scene, after.scene);
    if (sceneName !== null) return sceneName;
  }
  const field = PROJECT_FIELD_NAMES.find(([key]) => before[key] !== after[key]);
  return field?.[1] ?? 'Edit project';
}

function describeSceneChange(before: Scene, after: Scene): string | null {
  const objects = describeObjectChange(before.objects, after.objects);
  if (objects !== null) return objects;
  if (before.groups !== after.groups) return groupChangeName(before.groups, after.groups);
  if (before.layers !== after.layers) return layerChangeName(before.layers, after.layers);
  if (before.artworkOrder !== after.artworkOrder) return 'Change run order';
  return null;
}

function groupChangeName(
  before: ReadonlyArray<SceneGroup> = [],
  after: ReadonlyArray<SceneGroup> = [],
): string {
  if (after.length > before.length) return 'Group';
  if (after.length < before.length) return 'Ungroup';
  return 'Change groups';
}

function layerChangeName(before: ReadonlyArray<Layer>, after: ReadonlyArray<Layer>): string {
  if (after.length > before.length) return 'Add operation';
  if (after.length < before.length) return 'Remove operation';
  const beforeById = new Map(before.map((layer) => [layer.id, layer]));
  const changed = after.filter((layer) => beforeById.get(layer.id) !== layer);
  const [only] = changed;
  if (changed.length === 0) return 'Reorder operations';
  if (changed.length === 1 && only !== undefined && beforeById.has(only.id)) {
    return `Change ${only.name} settings`;
  }
  return 'Change operation settings';
}
