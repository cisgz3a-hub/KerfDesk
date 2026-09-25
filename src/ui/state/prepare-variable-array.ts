import {
  arrayPlacements,
  combinedBBox,
  type GridArraySpec,
  type SceneObject,
} from '../../core/scene';
import { variableCopyOffset } from '../../core/variables';
import {
  objectVariableTemplate,
  restoreVariableSource,
  withVariableSequenceOffset,
} from '../../core/variables/object-variable-template';
import {
  materializeVariableText,
  type VariableTextRenderer,
} from '../../io/gcode/prepare-output-snapshot';
import type { ArrayMaterialization } from './array-actions';
import { sceneObjectCopyClosure } from './scene-object-copy-dependencies';
import type { AppState } from './store';

type SelectionState = Pick<AppState, 'project' | 'selectedObjectId' | 'additionalSelectedIds'>;
export type VariableArrayResult =
  | { readonly ok: true; readonly materialized: ArrayMaterialization }
  | { readonly ok: false; readonly message: string; readonly cancelled?: true };

/** Render every assigned copy before deriving spacing. Never mutates or advances a cursor. */
export async function prepareVariableArray(
  state: SelectionState,
  spec: GridArraySpec,
  options: {
    readonly render: VariableTextRenderer;
    readonly clock: () => Date;
    readonly isCurrent?: () => boolean;
  },
): Promise<VariableArrayResult> {
  const selectedIds = new Set([
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ]);
  const sources = sceneObjectCopyClosure(state.project.scene.objects, selectedIds);
  const selected = sources.filter((object) => selectedIds.has(object.id));
  const bounds = combinedBBox(selected);
  if (bounds === null)
    return { ok: false, message: 'Select a design to create its variable copies.' };
  const offsets = sources.flatMap((object) =>
    objectVariableTemplate(object) === undefined ? [] : [variableCopyOffset(object) ?? 0],
  );
  if (offsets.length === 0)
    return {
      ok: false,
      message: 'This design has no variable text or barcode. Create an ordinary array instead.',
    };
  const stride = copyStride(offsets);
  const seeds = arrayPlacements(bounds, spec);
  const now = options.clock();
  const slots: SceneObject[][] = [];
  for (let index = 0; index < seeds.length; index += 1) {
    if (options.isCurrent?.() === false) return cancelled();
    const assigned = sources.map((object) => assignCopyOffset(object, index * stride));
    const slotProject = { ...state.project, scene: { ...state.project.scene, objects: assigned } };
    const rendered = await materializeVariableText(slotProject, { now }, options.render);
    if (options.isCurrent?.() === false) return cancelled();
    if (!rendered.ok)
      return {
        ok: false,
        message: `Copy ${index + 1}: ${rendered.preflight.issues.map((issue) => issue.message).join(' ')}`,
      };
    const assignedById = new Map(assigned.map((object) => [object.id, object] as const));
    slots.push(
      rendered.project.scene.objects.map((object) =>
        restoreVariableSource(object, assignedById.get(object.id)),
      ),
    );
  }
  const envelope = combinedBBox(
    slots.flatMap((slot) => slot.filter((object) => selectedIds.has(object.id))),
  );
  if (envelope === null)
    return { ok: false, message: 'The variable copies have no rendered bounds.' };
  return { ok: true, materialized: { bounds: envelope, sources: slots } };
}

function copyStride(offsets: readonly number[]): number {
  let minimum = offsets[0] ?? 0;
  let maximum = minimum;
  for (const offset of offsets) {
    minimum = Math.min(minimum, offset);
    maximum = Math.max(maximum, offset);
  }
  return maximum - minimum + 1;
}

function assignCopyOffset(object: SceneObject, delta: number): SceneObject {
  return withVariableSequenceOffset(object, (variableCopyOffset(object) ?? 0) + delta);
}

function cancelled(): VariableArrayResult {
  return {
    ok: false,
    cancelled: true,
    message: 'The design changed while its variable copies were being prepared.',
  };
}
