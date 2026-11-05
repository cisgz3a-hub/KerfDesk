import { arrayPlacements, combinedBBox, type ArraySpec, type SceneObject } from '../../core/scene';
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
import { arraySelectionIds, type ArrayMaterialization } from './array-actions';
import { arraySpecRoomProblem } from './array-room';
import { copiesThatFit } from './scene-copy-room';
import { sceneObjectCopyClosure } from './scene-object-copy-dependencies';
import { variableArrayMaterialization } from './variable-array-placement';
import type { AppState } from './store';

type SelectionState = Pick<AppState, 'project' | 'selectedObjectId' | 'additionalSelectedIds'>;
type VariableArrayOptions = {
  readonly render: VariableTextRenderer;
  readonly clock: () => Date;
  readonly advanceVariables?: boolean;
  readonly isCurrent?: () => boolean;
  readonly yieldNow?: () => Promise<void>;
  readonly onProgress?: (done: number, total: number) => void;
};
export type VariableArrayResult =
  | { readonly ok: true; readonly materialized: ArrayMaterialization }
  | { readonly ok: false; readonly message: string; readonly cancelled?: true };

/**
 * Render every assigned copy before deriving placement. Never mutates or advances a cursor.
 *
 * A record's render settles in microtasks, so without `yieldNow` the whole batch is one task:
 * 100 badges froze the window for 8 s and Cancel landed after every copy was made (performance
 * audit S7-P2-1). The dialogs pass `yieldNow` (variable-copy-slices.ts), which gives the event
 * loop a turn between copies, so paint, progress and Cancel go through and `isCurrent` sees them.
 */
export async function prepareVariableArray(
  state: SelectionState,
  spec: ArraySpec,
  options: VariableArrayOptions,
): Promise<VariableArrayResult> {
  const selectedIds = arraySelectionIds(state, spec);
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
  // Every copy is rendered in turn, so a request the project has no room for is
  // refused before the first one, not after a render for each (ADR-307 amendment 1).
  const room = copiesThatFit(state.project.scene.objects.length, sources.length);
  const tooMany = arraySpecRoomProblem(room, spec);
  if (tooMany !== null) return { ok: false, message: tooMany };
  const stride = copyStride(offsets);
  const seeds = arrayPlacements(bounds, spec);
  const now = options.clock();
  const strideFor = (index: number): number =>
    options.advanceVariables === false ? 0 : index * stride;
  const slots = await renderCopies(state.project, sources, seeds.length, strideFor, now, options);
  if (!Array.isArray(slots)) return slots;
  const materialized = variableArrayMaterialization(spec, selectedIds, slots);
  if (materialized === null)
    return { ok: false, message: 'The variable copies have no rendered bounds.' };
  return {
    ok: true,
    materialized: {
      ...materialized,
      evaluationTime: now.toISOString(),
      advanceVariables: options.advanceVariables !== false,
    },
  };
}

// Each copy in turn, with the event loop's turn and the progress between copies.
async function renderCopies(
  project: SelectionState['project'],
  sources: ReadonlyArray<SceneObject>,
  count: number,
  offsetFor: (index: number) => number,
  now: Date,
  options: VariableArrayOptions,
): Promise<SceneObject[][] | VariableArrayResult> {
  const isCurrent = options.isCurrent ?? (() => true);
  const slots: SceneObject[][] = [];
  for (let index = 0; index < count; index += 1) {
    if (!isCurrent()) return cancelled();
    const assigned = sources.map((object) => assignCopyOffset(object, offsetFor(index)));
    const slotProject = { ...project, scene: { ...project.scene, objects: assigned } };
    const rendered = await materializeVariableText(slotProject, { now }, options.render);
    if (!isCurrent()) return cancelled();
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
    options.onProgress?.(index + 1, count);
    await options.yieldNow?.();
  }
  return isCurrent() ? slots : cancelled();
}

export function copyStride(offsets: readonly number[]): number {
  let minimum = offsets[0] ?? 0;
  let maximum = minimum;
  for (const offset of offsets) {
    minimum = Math.min(minimum, offset);
    maximum = Math.max(maximum, offset);
  }
  return maximum - minimum + 1;
}

export function assignCopyOffset(object: SceneObject, delta: number): SceneObject {
  return withVariableSequenceOffset(object, (variableCopyOffset(object) ?? 0) + delta);
}

function cancelled(): VariableArrayResult {
  return {
    ok: false,
    cancelled: true,
    message: 'The design changed while its variable copies were being prepared.',
  };
}
