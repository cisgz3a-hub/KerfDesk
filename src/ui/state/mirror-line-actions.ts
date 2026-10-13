// Mirror Across Line (LightBurn Arrange): a mirrored duplicate of the
// selection across a straight two-point line, which must be the last object
// added to the selection. The originals and the line stay; the mirrored copies
// become the selection, all in one undo step. The reflection is exact
// (core/scene/selection-rotate.ts), so text, images and barcodes stay editable.

import {
  applyTransform,
  polylineToCurveSubpath,
  type ColoredPath,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { buildSelectionMirrorAcrossLineEdit } from '../../core/scene/selection-rotate';
import { refuseSceneLimitOverrun } from './scene-copy-room';
import { applyDuplicate } from './scene-mutations';
import { selectedObjectIds } from './scene-group-actions';
import { selectionReferenceId } from './selection-reference';
import type { AppState } from './store';
import { useToastStore } from './toast-store';

export type MirrorLineActions = {
  readonly mirrorSelectionAcrossLine: () => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

const NEEDS_LINE =
  'Select the artwork to mirror, then add a straight line with only two points to the selection last.';

export function mirrorLineActions(set: Setter): MirrorLineActions {
  return {
    mirrorSelectionAcrossLine: () =>
      set((state) => {
        const ids = selectedObjectIds(state);
        const lineId = selectionReferenceId(state) ?? ids.at(-1);
        const line = state.project.scene.objects.find((object) => object.id === lineId);
        const ends = line === undefined ? null : straightLineEnds(line);
        const targets = ids.filter((id) => id !== lineId);
        if (ends === null || targets.length === 0) return notice(state, NEEDS_LINE);
        const [first, ...rest] = targets;
        const duplicated = applyDuplicate(
          { ...state, selectedObjectId: first ?? null, additionalSelectedIds: new Set(rest) },
          () => crypto.randomUUID(),
        );
        if (duplicated === null) return state;
        const copyIds = new Set([duplicated.selectedObjectId, ...duplicated.additionalSelectedIds]);
        const copies = duplicated.project.scene.objects.filter((object) => copyIds.has(object.id));
        const mirrored = buildSelectionMirrorAcrossLineEdit(copies, ends[0], ends[1]);
        if (mirrored.kind === 'error') return state;
        const byId = new Map(mirrored.transforms.map((edit) => [edit.id, edit.transform]));
        const scene = {
          ...duplicated.project.scene,
          objects: duplicated.project.scene.objects.map((object) => {
            const transform = byId.get(object.id);
            return transform === undefined ? object : { ...object, transform };
          }),
        };
        if (refuseSceneLimitOverrun(state.project.scene, scene, 'Mirror fewer objects.'))
          return state;
        return {
          ...duplicated,
          project: { ...duplicated.project, scene },
          selectionReference: null,
        };
      }),
  };
}

/** The scene-space ends of an object that is one straight two-point line, else null. */
export function straightLineEnds(object: SceneObject): readonly [Vec2, Vec2] | null {
  if (!('paths' in object) || object.paths.length !== 1) return null;
  const path = object.paths[0] as ColoredPath;
  const curves = path.curves ?? path.polylines.map(polylineToCurveSubpath);
  const curve = curves.length === 1 ? curves[0] : undefined;
  const segment = curve?.segments.length === 1 ? curve.segments[0] : undefined;
  if (curve === undefined || segment?.kind !== 'line' || curve.closed) return null;
  return [
    applyTransform(curve.start, object.transform),
    applyTransform(segment.to, object.transform),
  ];
}

function notice(state: AppState, message: string): AppState {
  useToastStore.getState().pushToast(message, 'warning');
  return state;
}
